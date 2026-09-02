package foxchat.jakefox.de

import android.content.Context
import android.util.Log
import android.util.Base64
import app.tauri.remotepush.PushNotificationPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import org.matrix.rustcomponents.sdk.Client
import org.matrix.rustcomponents.sdk.ClientBuilder
import org.matrix.rustcomponents.sdk.ClientSessionDelegate
import org.matrix.rustcomponents.sdk.DateDividerMode
import org.matrix.rustcomponents.sdk.LogLevel
import org.matrix.rustcomponents.sdk.NotificationClient
import org.matrix.rustcomponents.sdk.NotificationProcessSetup
import org.matrix.rustcomponents.sdk.NotificationStatus
import org.matrix.rustcomponents.sdk.ReceiptType
import org.matrix.rustcomponents.sdk.RoomList
import org.matrix.rustcomponents.sdk.RoomListEntriesListener
import org.matrix.rustcomponents.sdk.RoomListEntriesUpdate
import org.matrix.rustcomponents.sdk.RoomListEntriesWithDynamicAdaptersResult
import org.matrix.rustcomponents.sdk.RoomListService
import org.matrix.rustcomponents.sdk.Session
import org.matrix.rustcomponents.sdk.SecretsBundleWithUserId
import org.matrix.rustcomponents.sdk.SlidingSyncVersion
import org.matrix.rustcomponents.sdk.SlidingSyncVersionBuilder
import org.matrix.rustcomponents.sdk.SqliteStoreBuilder
import org.matrix.rustcomponents.sdk.SyncService
import org.matrix.rustcomponents.sdk.SyncServiceState
import org.matrix.rustcomponents.sdk.SyncServiceStateObserver
import org.matrix.rustcomponents.sdk.TaskHandle
import org.matrix.rustcomponents.sdk.Timeline
import org.matrix.rustcomponents.sdk.TimelineConfiguration
import org.matrix.rustcomponents.sdk.TimelineDiff
import org.matrix.rustcomponents.sdk.TimelineFilter
import org.matrix.rustcomponents.sdk.TimelineFocus
import org.matrix.rustcomponents.sdk.TimelineItem
import org.matrix.rustcomponents.sdk.TimelineListener
import org.matrix.rustcomponents.sdk.TracingConfiguration
import org.matrix.rustcomponents.sdk.initPlatform
import uniffi.matrix_sdk_ui.TimelineEventFocusThreadMode
import uniffi.matrix_sdk_ui.TimelineReadReceiptTracking
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

data class NativeMatrixDecryptedEvent(
    val userId: String,
    val roomId: String,
    val eventId: String,
    val senderId: String,
    val senderName: String,
    val roomName: String,
    val rawEvent: String,
) {
    fun body(): String {
        val content = runCatching { JSONObject(rawEvent).optJSONObject("content") }.getOrNull()
        return content?.optString("body")?.takeIf { it.isNotBlank() }
            ?: content?.optString("name")?.takeIf { it.isNotBlank() }
            ?: "New message"
    }
}

/**
 * Process-wide owner of the Android Matrix Rust SDK clients.
 *
 * Both MainActivity and FirebaseMessagingService enter through this object. Every account has
 * one mutex, one encrypted SQLite store and one SyncService. No Activity or WebView reference is
 * retained, so Android can recreate the process for an FCM delivery and restore the same client.
 */
object NativeMatrixClientManager {
    private const val TAG = "FoxChatNativeMatrix"
    private val platformInitLock = Any()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val accounts = ConcurrentHashMap<String, AccountRuntime>()
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val roomListSubscriptions = ConcurrentHashMap<String, RoomListSubscription>()
    @Volatile private var applicationContext: Context? = null
    @Volatile private var platformInitialized = false

    private data class AccountRuntime(
        val userId: String,
        val client: Client,
        val syncService: SyncService,
        val notificationClient: NotificationClient,
        val syncStartup: CompletableDeferred<SyncServiceState>,
        val syncStateHandle: TaskHandle,
        val timelineSubscriptions: ConcurrentHashMap<String, TimelineSubscription> = ConcurrentHashMap(),
    )

    private data class TimelineSubscription(
        val timeline: Timeline,
        val handle: TaskHandle,
        val lastJsonByEventId: ConcurrentHashMap<String, String> = ConcurrentHashMap(),
    )

    private data class RoomListSubscription(
        val service: RoomListService,
        val list: RoomList,
        val entries: RoomListEntriesWithDynamicAdaptersResult,
        val stream: TaskHandle,
    )

    /** Matrix Rust SDK platform setup is process-global and must happen before any client. */
    fun initializePlatform() {
        if (platformInitialized) return
        synchronized(platformInitLock) {
            if (platformInitialized) return
            initPlatform(
                TracingConfiguration(
                    logLevel = LogLevel.INFO,
                    traceLogPacks = emptyList(),
                    extraTargets = emptyList(),
                    writeToStdoutOrSystem = false,
                    writeToFiles = null,
                    sentryConfig = null,
                ),
                useLightweightTokioRuntime = true,
            )
            platformInitialized = true
        }
    }

    fun bootstrap(context: Context) {
        initializePlatform()
        applicationContext = context.applicationContext
        NativeMatrixMigrationStore.accounts(context)
            .filter { it.state == NativeMatrixMigrationStore.State.READY }
            .forEach { account ->
                scope.launch {
                    runCatching {
                        val runtime = ensureRuntime(context, account.userId)
                        awaitSyncRunning(runtime)
                        ensureRoomListSubscription(runtime, account.userId)
                    }
                        .onFailure { Log.e(TAG, "Could not restore ${account.userId}", it) }
                }
            }
    }

    /**
     * Starts the one-time same-device hand-off. The caller must have stopped matrix-js-sdk first.
     * We persist STAGED before opening Rust, and READY only after the native session, encrypted
     * stores and SyncService have all opened successfully.
     */
    fun adoptExistingDevice(
        context: Context,
        userId: String,
        deviceId: String,
        homeserver: String,
        accessToken: String,
        refreshToken: String?,
        secretsBundle: String?,
        backupInfo: String?,
        validationRoomId: String?,
        validationEventId: String?,
    ): JSONObject = runBlocking(Dispatchers.IO) {
        initializePlatform()
        applicationContext = context.applicationContext
        val sessionJson = JSONObject()
            .put("userId", userId)
            .put("deviceId", deviceId)
            .put("homeserver", homeserver.trimEnd('/'))
            .put("accessToken", accessToken)
            .put("refreshToken", refreshToken)
            .put("slidingSyncVersion", SlidingSyncVersion.NATIVE.name)
        check(!secretsBundle.isNullOrBlank() && !backupInfo.isNullOrBlank()) {
            "Native Matrix adoption requires a trusted secrets bundle and key-backup metadata"
        }
        check(!validationRoomId.isNullOrBlank() && !validationEventId.isNullOrBlank()) {
            "Native Matrix adoption requires a decrypted event for cut-over validation"
        }
        NativeMatrixMigrationStore.stage(context, sessionJson, secretsBundle, backupInfo)
        NativeMatrixMigrationStore.setState(context, userId, NativeMatrixMigrationStore.State.ADOPTING)
        try {
            val runtime = ensureRuntime(context, userId)
            NativeMatrixMigrationStore.setState(context, userId, NativeMatrixMigrationStore.State.VALIDATING)
            check(runtime.client.userId() == userId) { "Native Matrix user does not match the staged account" }
            check(runtime.client.deviceId() == deviceId) { "Native Matrix device does not match the staged device" }
            awaitSyncRunning(runtime)
            ensureRoomListSubscription(runtime, userId)
            withTimeout(60_000L) {
                runtime.client.encryption().waitForE2eeInitializationTasks()
                val validation = runtime.notificationClient.getNotification(
                    validationRoomId,
                    validationEventId,
                )
                check(validation is NotificationStatus.Event) {
                    "Native Matrix could not decrypt the cut-over event: $validation"
                }
            }
            NativeMatrixMigrationStore.setState(context, userId, NativeMatrixMigrationStore.State.READY)
            NativeMatrixMigrationStore.clearMigrationSecrets(context, userId)
            JSONObject()
                .put("ok", true)
                .put("userId", userId)
                .put("deviceId", deviceId)
                .put("state", NativeMatrixMigrationStore.State.READY.wireName)
        } catch (error: Throwable) {
            accounts.remove(userId)?.let(::closeRuntime)
            NativeMatrixMigrationStore.setState(
                context, userId, NativeMatrixMigrationStore.State.ERROR, error,
            )
            throw error
        }
    }

    /**
     * Claims the untouched device returned by Matrix registration. Unlike an upgrade migration,
     * this device has never had a crypto owner, so Rust can initialize its Olm identity without
     * replacing or competing with a WebView crypto store.
     */
    fun adoptFreshSession(
        context: Context,
        userId: String,
        deviceId: String,
        homeserver: String,
        accessToken: String,
        refreshToken: String?,
    ): JSONObject = runBlocking(Dispatchers.IO) {
        applicationContext = context.applicationContext
        check(NativeMatrixMigrationStore.account(context, userId) == null) {
            "Native Matrix account $userId is already stored"
        }
        val sessionJson = JSONObject()
            .put("userId", userId)
            .put("deviceId", deviceId)
            .put("homeserver", homeserver.trimEnd('/'))
            .put("accessToken", accessToken)
            .put("refreshToken", refreshToken)
            .put("slidingSyncVersion", SlidingSyncVersion.NATIVE.name)
        val root = File(
            context.noBackupFilesDir,
            "matrix-rust/${NativeMatrixMigrationStore.storeDirectoryName(userId)}",
        )
        NativeMatrixMigrationStore.stage(context, sessionJson, null, null)
        NativeMatrixMigrationStore.setState(
            context, userId, NativeMatrixMigrationStore.State.VALIDATING,
        )
        try {
            val runtime = ensureRuntime(context, userId)
            check(runtime.client.userId() == userId) { "Native Matrix user does not match registration" }
            check(runtime.client.deviceId() == deviceId) { "Native Matrix device does not match registration" }
            awaitSyncRunning(runtime)
            ensureRoomListSubscription(runtime, userId)
            withTimeout(60_000L) { runtime.client.encryption().waitForE2eeInitializationTasks() }
            NativeMatrixMigrationStore.setState(
                context, userId, NativeMatrixMigrationStore.State.READY,
            )
            JSONObject()
                .put("ok", true)
                .put("userId", userId)
                .put("deviceId", deviceId)
                .put("state", NativeMatrixMigrationStore.State.READY.wireName)
        } catch (error: Throwable) {
            accounts.remove(userId)?.let(::closeRuntime)
            NativeMatrixMigrationStore.removeAccount(context, userId)
            if (root.exists()) root.deleteRecursively()
            throw error
        }
    }

    fun status(context: Context): JSONObject = NativeMatrixMigrationStore.status(context)

    fun loginNewAccount(
        context: Context,
        homeserver: String,
        username: String,
        password: String,
    ): JSONObject = runBlocking(Dispatchers.IO) {
        initializePlatform()
        applicationContext = context.applicationContext
        val secret = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val passphrase = Base64.encodeToString(secret, Base64.NO_WRAP)
        val storeId = NativeMatrixMigrationStore.storeDirectoryName(
            "${homeserver.trimEnd('/')}\u0000$username\u0000${System.nanoTime()}",
        )
        val root = File(context.noBackupFilesDir, "matrix-rust/new/$storeId")
        val data = File(root, "data").apply { mkdirs() }
        val cache = File(root, "cache").apply { mkdirs() }
        var savedSession: Session? = null
        val delegate = object : ClientSessionDelegate {
            override fun retrieveSessionFromKeychain(userId: String): Session =
                savedSession ?: error("The native login session is not available yet")

            override fun saveSessionInKeychain(session: Session) {
                savedSession = session
                if (NativeMatrixMigrationStore.account(context, session.userId) != null) {
                    NativeMatrixMigrationStore.updateSession(context, sessionToJson(session, root))
                }
            }
        }
        var client: Client? = null
        var userId: String? = null
        var stage = "homeserver discovery and client creation"
        try {
            client = ClientBuilder()
                .serverNameOrHomeserverUrl(homeserver)
                .slidingSyncVersionBuilder(SlidingSyncVersionBuilder.NATIVE)
                .sqliteStore(SqliteStoreBuilder(data.absolutePath, cache.absolutePath).passphrase(passphrase))
                .setSessionDelegate(delegate)
                .autoEnableBackups(true)
                .autoEnableCrossSigning(true)
                .build()
            stage = "password login"
            client.login(username, password, "FoxChat Android", null)
            stage = "reading the authenticated session"
            val session = client.session()
            if (NativeMatrixMigrationStore.account(context, session.userId) != null) {
                runCatching { client.logout() }
                error("This Matrix account is already stored on Android")
            }
            userId = session.userId
            stage = "persisting the native session"
            val sessionJson = sessionToJson(session, root)
            NativeMatrixMigrationStore.stage(
                context, sessionJson, null, null, storePassphrase = passphrase,
            )
            NativeMatrixMigrationStore.setState(
                context, session.userId, NativeMatrixMigrationStore.State.VALIDATING,
            )
            client.enableAllSendQueues(true)
            val syncService = client.syncService().finish()
            val notificationClient = client.notificationClient(
                NotificationProcessSetup.SingleProcess(syncService),
            )
            val (syncStartup, syncStateHandle) = startSync(syncService, session.userId)
            val runtime = AccountRuntime(
                session.userId, client, syncService, notificationClient, syncStartup, syncStateHandle,
            )
            accounts[session.userId] = runtime
            stage = "starting native sync"
            awaitSyncRunning(runtime)
            ensureRoomListSubscription(runtime, session.userId)
            stage = "initializing end-to-end encryption"
            withTimeout(60_000L) { client.encryption().waitForE2eeInitializationTasks() }
            NativeMatrixMigrationStore.setState(
                context, session.userId, NativeMatrixMigrationStore.State.READY,
            )
            JSONObject()
                .put("baseUrl", session.homeserverUrl)
                .put("accessToken", session.accessToken)
                .put("refreshToken", session.refreshToken)
                .put("userId", session.userId)
                .put("deviceId", session.deviceId)
        } catch (error: Throwable) {
            Log.e(TAG, "Native login failed during $stage", error)
            userId?.let { failedUserId ->
                accounts.remove(failedUserId)?.let(::closeRuntime)
                NativeMatrixMigrationStore.removeAccount(context, failedUserId)
            }
            runCatching { client?.logout() }
            runCatching { client?.close() }
            if (root.exists()) root.deleteRecursively()
            throw IllegalStateException(
                "Native Matrix login failed during $stage: ${errorSummary(error)}",
                error,
            )
        }
    }

    fun isReady(context: Context, userId: String): Boolean =
        NativeMatrixMigrationStore.isReady(context, userId)

    fun sessionTokens(context: Context, userId: String): JSONObject? {
        val session = NativeMatrixMigrationStore.account(context, userId)?.session ?: return null
        return JSONObject()
            .put("accessToken", session.optString("accessToken"))
            .put("refreshToken", session.optString("refreshToken").takeIf { it.isNotBlank() })
            .put("refreshedAt", session.optLong("refreshedAt", 0L))
    }

    fun decryptEvent(context: Context, roomId: String, eventId: String): NativeMatrixDecryptedEvent =
        runBlocking(Dispatchers.IO) {
            val candidates = NativeMatrixMigrationStore.accounts(context)
                .filter { it.state == NativeMatrixMigrationStore.State.READY }
            var lastError: Throwable? = null
            for (candidate in candidates) {
                try {
                    val runtime = ensureRuntime(context, candidate.userId)
                    val room = runtime.client.getRoom(roomId) ?: continue
                    // NotificationClient applies push rules and therefore intentionally filters
                    // quiet timeline items. A focused Timeline gives the WebView full decrypted
                    // JSON for live messages/state and for events loaded through pagination.
                    val rawEvent = runCatching { timelineEventJson(room, eventId) }
                        .getOrElse { timelineError ->
                            when (val status = runtime.notificationClient.getNotification(roomId, eventId)) {
                                is NotificationStatus.Event -> status.item.rawEvent
                                else -> throw IllegalStateException(
                                    "Native event is not available yet: $status",
                                    timelineError,
                                )
                            }
                        }
                    val senderId = JSONObject(rawEvent).optString("sender").ifBlank {
                        error("Native Matrix returned no sender for $eventId")
                    }
                    val senderName = runCatching { room.memberDisplayName(senderId) }
                        .getOrNull()?.ifBlank { senderId } ?: senderId
                    return@runBlocking NativeMatrixDecryptedEvent(
                        userId = candidate.userId,
                        roomId = roomId,
                        eventId = eventId,
                        senderId = senderId,
                        senderName = senderName,
                        roomName = room.displayName().orEmpty().ifBlank { "FoxChat" },
                        rawEvent = rawEvent,
                    )
                } catch (error: Throwable) {
                    lastError = error
                }
            }
            throw lastError ?: IllegalStateException("No native Matrix account owns $roomId")
        }

    fun sendRaw(
        context: Context,
        userId: String,
        roomId: String,
        eventType: String,
        contentJson: String,
    ) = runBlocking(Dispatchers.IO) {
        val room = ensureRuntime(context, userId).client.getRoom(roomId)
            ?: error("Room $roomId is unavailable for $userId")
        room.sendRaw(eventType, contentJson)
    }

    fun sendRawForRoom(context: Context, roomId: String, eventType: String, contentJson: String) =
        runBlocking(Dispatchers.IO) {
            val room = runtimeForRoom(context, roomId).client.getRoom(roomId)
                ?: error("Room $roomId is unavailable natively")
            room.sendRaw(eventType, contentJson)
        }

    /**
     * Keeps the authoritative Rust timeline for an opened room connected to the WebView.
     * Subscriptions live in the process-wide account runtime, not the Activity, so a recreated
     * WebView can attach again without creating another Matrix device or client.
     */
    fun watchRoom(context: Context, userId: String, roomId: String): JSONObject =
        runBlocking(Dispatchers.IO) {
            val runtime = ensureRuntime(context, userId)
            if (runtime.timelineSubscriptions.containsKey(roomId)) {
                return@runBlocking JSONObject().put("ok", true).put("alreadyWatching", true)
            }
            val room = withTimeout(30_000L) {
                var available = runtime.client.getRoom(roomId)
                while (available == null) {
                    delay(250L)
                    available = runtime.client.getRoom(roomId)
                }
                available
            }
            val timeline = room.timeline()
            val lastJsonByEventId = ConcurrentHashMap<String, String>()
            val handle = timeline.addListener(object : TimelineListener {
                override fun onUpdate(update: List<TimelineDiff>) {
                    timelineItems(update).forEach { item ->
                        val event = item.asEvent() ?: return@forEach
                        val raw = runCatching { event.lazyProvider.latestJson() }.getOrNull()
                            ?: return@forEach
                        val eventId = runCatching { JSONObject(raw).optString("event_id") }
                            .getOrNull()?.takeIf { it.isNotBlank() } ?: return@forEach
                        if (lastJsonByEventId.put(eventId, raw) == raw) return@forEach
                        PushNotificationPlugin.instance?.handleNativeMatrixEvent(
                            JSONObject()
                                .put("userId", userId)
                                .put("roomId", roomId)
                                .put("eventId", eventId)
                                .put("rawEvent", raw),
                        )
                    }
                }
            })
            val subscription = TimelineSubscription(timeline, handle, lastJsonByEventId)
            val previous = runtime.timelineSubscriptions.putIfAbsent(roomId, subscription)
            if (previous != null) closeTimelineSubscription(subscription)
            JSONObject().put("ok", true).put("alreadyWatching", previous != null)
        }

    fun markReadForRoom(context: Context, roomId: String) = runBlocking(Dispatchers.IO) {
        val room = runtimeForRoom(context, roomId).client.getRoom(roomId)
            ?: error("Room $roomId is unavailable natively")
        room.markAsRead(ReceiptType.READ)
        room.markAsRead(ReceiptType.FULLY_READ)
    }

    fun sendStateRaw(
        context: Context,
        userId: String,
        roomId: String,
        eventType: String,
        stateKey: String,
        contentJson: String,
    ): String = runBlocking(Dispatchers.IO) {
        val room = ensureRuntime(context, userId).client.getRoom(roomId)
            ?: error("Room $roomId is unavailable for $userId")
        room.sendStateEventRaw(eventType, stateKey, contentJson)
    }

    fun redact(context: Context, userId: String, roomId: String, eventId: String, reason: String?) =
        runBlocking(Dispatchers.IO) {
            val room = ensureRuntime(context, userId).client.getRoom(roomId)
                ?: error("Room $roomId is unavailable for $userId")
            room.redact(eventId, reason)
        }

    fun setTyping(context: Context, userId: String, roomId: String, typing: Boolean) =
        runBlocking(Dispatchers.IO) {
            val room = ensureRuntime(context, userId).client.getRoom(roomId)
                ?: error("Room $roomId is unavailable for $userId")
            room.typingNotice(typing)
        }

    fun recover(context: Context, userId: String, recoveryKey: String) =
        runBlocking(Dispatchers.IO) {
            ensureRuntime(context, userId).client.encryption().recover(recoveryKey.trim())
        }

    fun logout(context: Context, userId: String) = runBlocking(Dispatchers.IO) {
        val root = NativeMatrixMigrationStore.account(context, userId)?.session
            ?.optString("storeRoot")?.takeIf { it.isNotBlank() }
            ?.let(::File)
            ?: File(
                context.noBackupFilesDir,
                "matrix-rust/${NativeMatrixMigrationStore.storeDirectoryName(userId)}",
            )
        val runtime = accounts.remove(userId) ?: runCatching { ensureRuntime(context, userId) }.getOrNull()
        if (runtime != null) {
            runCatching { runtime.client.logout() }
            closeRuntime(runtime)
        }
        NativeMatrixMigrationStore.removeAccount(context, userId)
        val allowedRoot = File(context.noBackupFilesDir, "matrix-rust").canonicalFile
        val resolvedRoot = root.canonicalFile
        check(resolvedRoot.path.startsWith(allowedRoot.path + File.separator)) {
            "Refusing to remove a Matrix store outside the app's native store root"
        }
        if (resolvedRoot.exists() && !resolvedRoot.deleteRecursively())
            error("Could not remove the native Matrix store")
    }

    private suspend fun ensureRuntime(context: Context, userId: String): AccountRuntime {
        initializePlatform()
        accounts[userId]?.let { return it }
        return lockFor(userId).withLock {
            accounts[userId]?.let { return@withLock it }
            val account = NativeMatrixMigrationStore.account(context, userId)
                ?: error("Native Matrix account $userId is not staged")
            val json = account.session ?: error("Native Matrix session for $userId is missing")
            check(account.storePassphrase.isNotBlank()) { "Native Matrix store key for $userId is missing" }

            val session = sessionFromJson(json)
            val root = json.optString("storeRoot").takeIf { it.isNotBlank() }
                ?.let(::File)
                ?: File(
                    context.noBackupFilesDir,
                    "matrix-rust/${NativeMatrixMigrationStore.storeDirectoryName(userId)}",
                )
            val data = File(root, "data").apply { mkdirs() }
            val cache = File(root, "cache").apply { mkdirs() }
            val store = SqliteStoreBuilder(data.absolutePath, cache.absolutePath)
                .passphrase(account.storePassphrase)
            val delegate = object : ClientSessionDelegate {
                override fun retrieveSessionFromKeychain(requestedUserId: String): Session =
                    NativeMatrixMigrationStore.account(context, requestedUserId)?.session
                        ?.let(::sessionFromJson)
                        ?: session

                override fun saveSessionInKeychain(session: Session) {
                    NativeMatrixMigrationStore.updateSession(context, sessionToJson(session, root))
                    PushNotificationPlugin.instance?.handleNativeMatrixSessionChanged(
                        session.userId,
                        session.accessToken,
                        session.refreshToken,
                    )
                }
            }
            val client = ClientBuilder()
                .homeserverUrl(session.homeserverUrl)
                .slidingSyncVersionBuilder(SlidingSyncVersionBuilder.NATIVE)
                .sqliteStore(store)
                .setSessionDelegate(delegate)
                .autoEnableBackups(true)
                .autoEnableCrossSigning(true)
                .build()
            client.restoreSession(session)
            if (!account.secretsBundle.isNullOrBlank() && !account.backupInfo.isNullOrBlank()) {
                val bundle = SecretsBundleWithUserId.fromStr(
                    userId,
                    account.secretsBundle,
                    account.backupInfo,
                )
                try {
                    client.encryption().importSecretsBundle(bundle)
                } finally {
                    bundle.close()
                }
            }
            client.enableAllSendQueues(true)
            val syncService = client.syncService().finish()
            val notificationClient = client.notificationClient(
                NotificationProcessSetup.SingleProcess(syncService),
            )
            val (syncStartup, syncStateHandle) = startSync(syncService, userId)
            val runtime = AccountRuntime(
                userId, client, syncService, notificationClient, syncStartup, syncStateHandle,
            )
            accounts[userId] = runtime
            runtime
        }
    }

    private suspend fun runtimeForRoom(context: Context, roomId: String): AccountRuntime {
        for (account in NativeMatrixMigrationStore.accounts(context)) {
            if (account.state != NativeMatrixMigrationStore.State.READY) continue
            val runtime = ensureRuntime(context, account.userId)
            if (runtime.client.getRoom(roomId) != null) return runtime
        }
        error("No native Matrix account owns $roomId")
    }

    private suspend fun timelineEventJson(
        room: org.matrix.rustcomponents.sdk.Room,
        eventId: String,
    ): String {
        // First use the live timeline: this avoids a context request for the common case where
        // both native sync and the observing WebView have just received the event.
        val liveTimeline = room.timeline()
        var liveTimelineError: Throwable? = null
        try {
            val item = liveTimeline.getEventTimelineItemByEventId(eventId)
            try {
                return checkedTimelineJson(item.lazyProvider.latestJson(), eventId, "live")
            } finally {
                item.destroy()
            }
        } catch (error: Throwable) {
            liveTimelineError = error
        } finally {
            liveTimeline.close()
        }

        // History pagination can expose an event that is not in Rust's current live window.
        // Focus the SDK timeline on that event so it fetches/decrypts the event plus context.
        val configuration = TimelineConfiguration(
            focus = TimelineFocus.Event(
                eventId,
                0u.toUShort(),
                TimelineEventFocusThreadMode.Automatic(hideThreadedEvents = false),
            ),
            filter = TimelineFilter.All,
            internalIdPrefix = "foxchat-native-event-",
            dateDividerMode = DateDividerMode.DAILY,
            trackReadReceipts = TimelineReadReceiptTracking.DISABLED,
            reportUtds = true,
        )
        try {
            val focusedTimeline = room.timelineWithConfiguration(configuration)
            try {
                val item = focusedTimeline.getEventTimelineItemByEventId(eventId)
                try {
                    return checkedTimelineJson(item.lazyProvider.latestJson(), eventId, "focused")
                } finally {
                    item.destroy()
                }
            } finally {
                focusedTimeline.close()
            }
        } catch (error: Throwable) {
            liveTimelineError?.let(error::addSuppressed)
            throw error
        } finally {
            configuration.destroy()
        }
    }

    private fun checkedTimelineJson(rawEvent: String?, eventId: String, source: String): String {
        val json = rawEvent ?: error("Native $source timeline returned no JSON for $eventId")
        check(JSONObject(json).optString("event_id") == eventId) {
            "Native $source timeline resolved $eventId to a different aggregated event"
        }
        return json
    }

    private fun timelineItems(diffs: List<TimelineDiff>): List<TimelineItem> = buildList {
        diffs.forEach { diff ->
            when (diff) {
                is TimelineDiff.Append -> addAll(diff.values)
                is TimelineDiff.Insert -> add(diff.value)
                is TimelineDiff.PushBack -> add(diff.value)
                is TimelineDiff.PushFront -> add(diff.value)
                is TimelineDiff.Reset -> addAll(diff.values)
                is TimelineDiff.Set -> add(diff.value)
                else -> Unit
            }
        }
    }

    private suspend fun ensureRoomListSubscription(runtime: AccountRuntime, userId: String) {
        if (roomListSubscriptions.containsKey(userId)) return
        val service = runtime.syncService.roomListService()
        val list = service.allRooms()
        val lastMembershipSignature = AtomicReference(roomMembershipSignature(runtime.client))
        val entries = list.entriesWithDynamicAdapters(
            1_000u,
            object : RoomListEntriesListener {
                override fun onUpdate(update: List<RoomListEntriesUpdate>) {
                    val signature = roomMembershipSignature(runtime.client)
                    if (lastMembershipSignature.getAndSet(signature) != signature) {
                        PushNotificationPlugin.instance?.handleNativeMatrixRoomsChanged(userId)
                    }
                }
            },
        )
        val subscription = RoomListSubscription(service, list, entries, entries.entriesStream())
        val previous = roomListSubscriptions.putIfAbsent(userId, subscription)
        if (previous != null) closeRoomListSubscription(subscription)
        else PushNotificationPlugin.instance?.handleNativeMatrixRoomsChanged(userId)
    }

    private fun roomMembershipSignature(client: Client): String = client.rooms()
        .map { room -> "${room.id()}:${room.membership().name}" }
        .sorted()
        .joinToString("|")

    private fun startSync(
        syncService: SyncService,
        userId: String,
    ): Pair<CompletableDeferred<SyncServiceState>, TaskHandle> {
        val startup = CompletableDeferred<SyncServiceState>()
        val handle = syncService.state(object : SyncServiceStateObserver {
            override fun onUpdate(update: SyncServiceState) {
                Log.i(TAG, "Sync state for $userId: $update")
                if (update == SyncServiceState.RUNNING || update == SyncServiceState.ERROR ||
                    update == SyncServiceState.TERMINATED || update == SyncServiceState.OFFLINE
                ) startup.complete(update)
            }
        })
        scope.launch {
            runCatching { syncService.start() }
                .onFailure { error ->
                    startup.completeExceptionally(error)
                    Log.e(TAG, "Sync stopped for $userId", error)
                }
        }
        return startup to handle
    }

    private suspend fun awaitSyncRunning(runtime: AccountRuntime) {
        val result = withTimeout(60_000L) { runtime.syncStartup.await() }
        check(result == SyncServiceState.RUNNING) { "Native Matrix sync entered $result" }
    }

    private fun sessionFromJson(json: JSONObject): Session = Session(
        accessToken = json.getString("accessToken"),
        refreshToken = json.optString("refreshToken").takeIf { it.isNotBlank() },
        userId = json.getString("userId"),
        deviceId = json.getString("deviceId"),
        homeserverUrl = json.getString("homeserver"),
        oauthData = json.optString("oauthData").takeIf { it.isNotBlank() },
        slidingSyncVersion = runCatching {
            SlidingSyncVersion.valueOf(json.optString("slidingSyncVersion", SlidingSyncVersion.NATIVE.name))
        }.getOrDefault(SlidingSyncVersion.NATIVE),
    )

    private fun sessionToJson(session: Session, storeRoot: File? = null): JSONObject = JSONObject()
        .put("accessToken", session.accessToken)
        .put("refreshToken", session.refreshToken)
        .put("userId", session.userId)
        .put("deviceId", session.deviceId)
        .put("homeserver", session.homeserverUrl)
        .put("oauthData", session.oauthData)
        .put("slidingSyncVersion", session.slidingSyncVersion.name)
        .put("refreshedAt", System.currentTimeMillis())
        .also { json -> if (storeRoot != null) json.put("storeRoot", storeRoot.absolutePath) }

    private fun lockFor(userId: String): Mutex = locks.getOrPut(userId) { Mutex() }

    private fun errorSummary(error: Throwable): String = generateSequence(error) { it.cause }
        .mapNotNull { cause ->
            val name = cause::class.java.simpleName.takeIf { it.isNotBlank() }
            val message = cause.message?.trim()?.takeIf { it.isNotBlank() }
            when {
                name != null && message != null -> "$name: $message"
                message != null -> message
                else -> name
            }
        }
        .distinct()
        .take(3)
        .joinToString("; ")
        .ifBlank { "unknown native error" }

    private fun closeRuntime(runtime: AccountRuntime) {
        roomListSubscriptions.remove(runtime.userId)?.let(::closeRoomListSubscription)
        runtime.timelineSubscriptions.values.forEach(::closeTimelineSubscription)
        runtime.timelineSubscriptions.clear()
        runCatching { runtime.syncStateHandle.cancel() }
        runCatching { runtime.syncStateHandle.close() }
        runCatching { runBlocking { runtime.syncService.stop() } }
        runCatching { runtime.notificationClient.close() }
        runCatching { runtime.syncService.close() }
        runCatching { runtime.client.close() }
    }

    private fun closeTimelineSubscription(subscription: TimelineSubscription) {
        runCatching { subscription.handle.cancel() }
        runCatching { subscription.handle.close() }
        runCatching { subscription.timeline.close() }
    }

    private fun closeRoomListSubscription(subscription: RoomListSubscription) {
        runCatching { subscription.stream.cancel() }
        runCatching { subscription.stream.close() }
        runCatching { subscription.entries.close() }
        runCatching { subscription.list.close() }
        runCatching { subscription.service.close() }
    }
}
