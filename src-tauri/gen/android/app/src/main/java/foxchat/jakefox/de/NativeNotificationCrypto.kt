package foxchat.jakefox.de

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.remotepush.NativeCryptoBridge
import org.json.JSONArray
import org.json.JSONObject
import org.matrix.rustcomponents.sdk.crypto.BackupRecoveryKey
import org.matrix.rustcomponents.sdk.crypto.DecryptionException
import org.matrix.rustcomponents.sdk.crypto.OlmMachine
import org.matrix.rustcomponents.sdk.crypto.ProgressListener
import uniffi.matrix_sdk_crypto.DecryptionSettings
import uniffi.matrix_sdk_crypto.TrustRequirement
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.io.FileOutputStream
import java.security.SecureRandom
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.Locale

data class NativeDecryptedNotification(
    val senderId: String,
    val senderName: String,
    val body: String,
    val timestamp: Long,
    val suppressed: Boolean = false,
)
private class MatrixRequestException(
    val requestStage: String,
    val httpStatus: Int,
    val matrixErrorCode: String?,
    val matrixErrorMessage: String?,
) : IllegalStateException(
    buildString {
        append("$requestStage failed with HTTP $httpStatus")
        if (!matrixErrorCode.isNullOrBlank()) append(" ($matrixErrorCode)")
        if (!matrixErrorMessage.isNullOrBlank()) append(": $matrixErrorMessage")
    },
)

private class NativePusherRequestException(
    val httpStatus: Int,
    details: String,
) : IllegalStateException(
    "Matrix pusher request failed with HTTP $httpStatus${if (details.isBlank()) "" else ": $details"}",
)

/** Decrypts notifications locally with secrets protected by Android Keystore. */
object NativeNotificationCrypto {
    private const val PREFS = "foxchat_native_crypto"
    private const val STATE_PREFS = "foxchat_native_crypto_state"
    // Version 2 replaced the old cross process store.
    private const val STORE_VERSION = 2
    private val machines = ConcurrentHashMap<String, OlmMachine>()
    private val locks = ConcurrentHashMap<String, Any>()
    private val roomMappingsLock = Any()

    @Synchronized
    fun recordNotificationDiagnostic(
        context: Context,
        outcome: String,
        roomId: String,
        eventId: String,
        error: Throwable? = null,
    ) {
        val prefs = preferences(context)
        val history = try {
            JSONArray(prefs.getString("notificationDiagnostics", "[]"))
        } catch (_: Exception) {
            JSONArray()
        }
        val diagnostic = JSONObject()
            .put("at", System.currentTimeMillis())
            .put("outcome", outcome)
            .put("roomId", roomId)
            .put("eventId", eventId)
            .put("error", error?.let { it.message ?: it.javaClass.simpleName })
            .put("errorDetails", error?.let { Log.getStackTraceString(it).take(8_000) })
        if (error is MatrixRequestException) {
            diagnostic
                .put("requestStage", error.requestStage)
                .put("httpStatus", error.httpStatus)
                .put("matrixErrorCode", error.matrixErrorCode)
                .put("matrixErrorMessage", error.matrixErrorMessage)
                .put(
                    "likelyCause",
                    when {
                        error.requestStage == "key-backup-session" && error.httpStatus == 404 ->
                            "The event exists, but this Megolm session has not reached key backup yet."
                        error.requestStage == "key-backup-version" && error.httpStatus == 404 ->
                            "The cached key-backup version no longer exists, possibly because backup was replaced."
                        error.httpStatus == 401 || error.httpStatus == 403 ->
                            "The stored Matrix credentials were rejected for this request."
                        else -> "The homeserver rejected a Matrix request needed for notification decryption."
                    },
                )
        }
        history.put(diagnostic)
        val trimmed = JSONArray()
        for (index in maxOf(0, history.length() - 20) until history.length()) {
            trimmed.put(history.get(index))
        }
        prefs.edit().putString("notificationDiagnostics", trimmed.toString()).commit()
    }

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).commit()
    }

    fun storePendingPushToken(context: Context, token: String) {
        preferences(context).edit().putString("pendingPushToken", token).commit()
    }

    fun pendingPushToken(context: Context): String? =
        preferences(context).getString("pendingPushToken", null)

    fun clearPendingPushToken(context: Context, expectedToken: String) {
        val prefs = preferences(context)
        if (prefs.getString("pendingPushToken", null) == expectedToken) {
            prefs.edit().remove("pendingPushToken").commit()
        }
    }

    fun isOwnUser(context: Context, userId: String): Boolean {
        if (userId.isBlank()) return false
        val prefs = preferences(context)
        return prefs.contains("$userId.device") ||
            prefs.contains("setup.$userId.deviceId")
    }

    /** Stages secrets for background import. */
    fun stageSync(
        context: Context,
        userId: String,
        deviceId: String,
        homeserver: String,
        accessToken: String,
        refreshToken: String?,
        roomKeys: String,
        rooms: String,
        backupVersion: String?,
        backupRecoveryKey: String?,
        pushClearToken: String?,
        pushGatewayUrl: String?,
    ) {
        synchronized(lockFor(userId)) {
            val prefs = preferences(context)
            val setup = "setup.$userId"
            val editor = prefs.edit()
                .putString("$setup.deviceId", deviceId)
                .putString("$setup.homeserver", homeserver)
                .putString("$setup.accessToken", accessToken)
                .putString("$setup.refreshToken", refreshToken)
                .putString("$setup.roomKeys", roomKeys)
                .putString("$setup.rooms", rooms)
                .putString("$setup.backupVersion", backupVersion)
                .putString("$setup.backupRecoveryKey", backupRecoveryKey)
                .putLong("$setup.startedAt", System.currentTimeMillis())
                .putLong("$setup.heartbeatAt", System.currentTimeMillis())
                .putString("$setup.phase", "staged")
                .putString("$setup.state", "pending")
                .remove("$setup.error")
                .remove("$setup.errorDetails")
            if (!pushClearToken.isNullOrBlank() && !pushGatewayUrl.isNullOrBlank()) {
                editor
                    .putString("$setup.pushClearToken", pushClearToken)
                    .putString("$setup.pushGatewayUrl", pushGatewayUrl.trimEnd('/'))
                    // Persist push metadata before the slower room-key import. Token
                    // rotation must still work if crypto setup is interrupted later.
                    .putString("$userId.pushClearToken", pushClearToken)
                    .putString("$userId.pushGatewayUrl", pushGatewayUrl.trimEnd('/'))
            }
            editor.commit()
            pendingPushToken(context)?.let { NativePushTokenManager.schedule(context, it) }
            val intent = Intent(context, NativeCryptoSetupService::class.java).putExtra("user_id", userId)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(context, intent)
            else context.startService(intent)
        }
    }

    fun completeStagedSync(context: Context, userId: String) {
        synchronized(lockFor(userId)) {
            val prefs = preferences(context)
            val setup = "setup.$userId"
            // Android can deliver multiple start commands for one staged
            // payload. The first worker consumes it; later workers must not
            // reinterpret the intentionally removed secrets as a setup error.
            if (prefs.getString("$setup.state", null) != "pending") return
            try {
                prefs.edit()
                    .putLong("$setup.heartbeatAt", System.currentTimeMillis())
                    .putString("$setup.phase", "opening native crypto store")
                    .commit()
                sync(
                    context,
                    userId,
                    prefs.getString("$setup.deviceId", null) ?: error("Staged device ID is missing"),
                    prefs.getString("$setup.homeserver", null) ?: error("Staged homeserver is missing"),
                    prefs.getString("$setup.accessToken", null) ?: error("Staged access token is missing"),
                    prefs.getString("$setup.refreshToken", null),
                    prefs.getString("$setup.roomKeys", null) ?: error("Staged room keys are missing"),
                    prefs.getString("$setup.rooms", null) ?: error("Staged room metadata is missing"),
                    prefs.getString("$setup.backupVersion", null),
                    prefs.getString("$setup.backupRecoveryKey", null),
                    prefs.getString("$setup.pushClearToken", null),
                    prefs.getString("$setup.pushGatewayUrl", null),
                )
                setEnabled(context, true)
                prefs.edit().putString("$setup.state", "ready").putString("$setup.phase", "ready")
                    .putLong("$setup.heartbeatAt", System.currentTimeMillis())
                    .remove("$setup.error").remove("$setup.errorDetails")
                    .remove("$setup.roomKeys").remove("$setup.rooms")
                    .remove("$setup.backupVersion").remove("$setup.backupRecoveryKey").commit()
            } catch (error: Throwable) {
                setEnabled(context, false)
                prefs.edit().putString("$setup.state", "error")
                    .putString("$setup.phase", "error")
                    .putLong("$setup.heartbeatAt", System.currentTimeMillis())
                    .putString("$setup.error", error.message ?: error.javaClass.simpleName)
                    .putString("$setup.errorDetails", Log.getStackTraceString(error).take(8_000))
                    .remove("$setup.roomKeys").remove("$setup.rooms")
                    .remove("$setup.backupVersion").remove("$setup.backupRecoveryKey").commit()
                throw error
            }
        }
    }

    fun markSetupTimedOut(context: Context, userId: String) {
        synchronized(lockFor(userId)) {
            val prefs = preferences(context)
            val setup = "setup.$userId"
            if (prefs.getString("$setup.state", null) != "pending") return
            prefs.edit()
                .putString("$setup.state", "error")
                .putString("$setup.phase", "error")
                .putLong("$setup.heartbeatAt", System.currentTimeMillis())
                .putString(
                    "$setup.error",
                    "Android stopped the background setup service before it finished importing keys",
                )
                .commit()
        }
    }

    fun sync(
        context: Context,
        userId: String,
        deviceId: String,
        homeserver: String,
        accessToken: String,
        refreshToken: String?,
        roomKeys: String,
        rooms: String,
        backupVersion: String?,
        backupRecoveryKey: String?,
        pushClearToken: String?,
        pushGatewayUrl: String?,
    ) {
        synchronized(lockFor(userId)) {
            val prefs = preferences(context)
            val exported = JSONArray(roomKeys)
            val credentialEditor = prefs.edit()
                .putString("$userId.device", deviceId)
                .putString("$userId.homeserver", homeserver.trimEnd('/'))
                .putString("$userId.token", accessToken)
                .putString("$userId.refreshToken", refreshToken)
                .remove("$userId.nativeSessionRefreshAt")
            if (!backupVersion.isNullOrBlank() && !backupRecoveryKey.isNullOrBlank()) {
                credentialEditor
                    .putString("$userId.backupVersion", backupVersion)
                    .putString("$userId.backupRecoveryKey", backupRecoveryKey)
            } else {
                credentialEditor
                    .remove("$userId.backupVersion")
                    .remove("$userId.backupRecoveryKey")
            }
            if (!pushClearToken.isNullOrBlank() && !pushGatewayUrl.isNullOrBlank()) {
                credentialEditor
                    .putString("$userId.pushClearToken", pushClearToken)
                    .putString("$userId.pushGatewayUrl", pushGatewayUrl.trimEnd('/'))
            }
            credentialEditor.apply()
            val machine = machine(context, userId, deviceId)
            prefs.edit()
                .putLong("setup.$userId.heartbeatAt", System.currentTimeMillis())
                .putString("setup.$userId.phase", "importing ${exported.length()} room keys")
                .commit()
            val imported = try {
                machine.importDecryptedRoomKeys(roomKeys, object : ProgressListener {
                    override fun onProgress(progress: Int, total: Int) {
                        prefs.edit()
                            .putLong("setup.$userId.heartbeatAt", System.currentTimeMillis())
                            .putString("setup.$userId.phase", "importing room keys ($progress/$total)")
                            .commit()
                    }
                })
            } catch (error: Exception) {
                prefs.edit()
                    .putLong("$userId.lastSyncAt", System.currentTimeMillis())
                    .putInt("$userId.exported", exported.length())
                    .putString("$userId.lastSyncError", "Key import failed: ${error.message ?: error.javaClass.simpleName}")
                    .commit()
                throw error
            }
            val editor = prefs.edit()
                .putLong("$userId.lastSyncAt", System.currentTimeMillis())
                .putInt("$userId.exported", exported.length())
                .putLong("$userId.imported", imported.imported)
                .putLong("$userId.importTotal", imported.total)
                .remove("$userId.lastSyncError")
                // Migrate the old shared error field. Sync and decrypt errors are
                // tracked separately now so a successful key copy cannot hide a
                // notification decryption failure that happened at the same time.
                .remove("$userId.lastError")
            val roomMetadata = JSONArray(rooms)
            val currentRooms = mutableSetOf<String>()
            for (index in 0 until roomMetadata.length()) {
                roomMetadata.optJSONObject(index)?.optString("roomId")
                    ?.takeIf { it.isNotBlank() }
                    ?.let(currentRooms::add)
            }
            synchronized(roomMappingsLock) {
                val previousRooms = prefs.getStringSet("$userId.rooms", emptySet())?.toSet().orEmpty()
                for (roomId in previousRooms + currentRooms) {
                    val mappingKey = "room.$roomId.accounts"
                    val accounts = prefs.getStringSet(mappingKey, emptySet())?.toMutableSet()
                        ?: mutableSetOf()
                    if (roomId in currentRooms) accounts.add(userId) else accounts.remove(userId)
                    if (accounts.isEmpty()) {
                        editor.remove(mappingKey)
                        if (prefs.getString("room.$roomId", null) == userId) {
                            editor.remove("room.$roomId")
                        }
                    } else {
                        editor.putStringSet(mappingKey, accounts)
                        // Keep the legacy preferred mapping for older installs and
                        // put the most recently synced account first when trying.
                        if (roomId in currentRooms) editor.putString("room.$roomId", userId)
                        else if (prefs.getString("room.$roomId", null) == userId) {
                            editor.putString("room.$roomId", accounts.first())
                        }
                    }
                }
                editor.putStringSet("$userId.rooms", currentRooms)
                for (index in 0 until roomMetadata.length()) {
                    val room = roomMetadata.optJSONObject(index) ?: continue
                    val roomId = room.optString("roomId")
                    if (roomId.isNotBlank()) {
                        editor.putString("room.$roomId.name", room.optString("name", "FoxChat"))
                    }
                }
                editor.commit()
            }
            syncRoomAvatars(context, accessToken, roomMetadata)
        }
    }

    private fun syncRoomAvatars(context: Context, accessToken: String, rooms: JSONArray) {
        val prefs = preferences(context)
        val directory = File(context.noBackupFilesDir, "notification-room-avatars").apply { mkdirs() }
        for (index in 0 until rooms.length()) {
            val room = rooms.optJSONObject(index) ?: continue
            val roomId = room.optString("roomId").takeIf { it.isNotBlank() } ?: continue
            val avatarUrl = room.optString("avatarUrl").takeIf { it.startsWith("http://") || it.startsWith("https://") }
            val sourceKey = "room.$roomId.avatarUrl.v2"
            val target = File(directory, "${safeName(roomId)}.img")
            if (avatarUrl == null) {
                target.delete()
                prefs.edit().remove(sourceKey).apply()
                continue
            }
            if (prefs.getString(sourceKey, null) == avatarUrl && target.isFile && target.length() > 0) continue
            try {
                val connection = URL(avatarUrl).openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 7_000
                    connection.readTimeout = 7_000
                    connection.setRequestProperty("Authorization", "Bearer $accessToken")
                    if (connection.responseCode !in 200..299) {
                        throw IllegalStateException("Avatar download failed with HTTP ${connection.responseCode}")
                    }
                    val temporary = File(directory, "${safeName(roomId)}.tmp")
                    val avatar = connection.inputStream.use { input ->
                        BitmapFactory.decodeStream(input)
                    } ?: throw IllegalStateException("Downloaded avatar is not a supported bitmap")
                    FileOutputStream(temporary).use { output ->
                        if (!avatar.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                            throw IllegalStateException("Could not encode cached avatar")
                        }
                    }
                    if (!temporary.renameTo(target)) {
                        temporary.copyTo(target, overwrite = true)
                        temporary.delete()
                    }
                    prefs.edit().putString(sourceKey, avatarUrl).apply()
                } finally {
                    connection.disconnect()
                }
            } catch (error: Exception) {
                Log.w("FoxChatNativeCrypto", "Could not cache avatar for $roomId", error)
            }
        }
    }

    /** Updates this installation's Matrix pusher for every stored account. */
    fun refreshPushersForToken(context: Context, firebaseToken: String): Boolean {
        if (firebaseToken.isBlank()) return true
        val prefs = preferences(context)
        val userIds = prefs.all.keys
            .filter { it.endsWith(".device") }
            .map { it.removeSuffix(".device") }
            .distinct()
            .sorted()
        var allSucceeded = true
        for (userId in userIds) {
            try {
                refreshPusherForAccount(prefs, userId, firebaseToken)
                prefs.edit()
                    .putLong("$userId.lastPushTokenRefreshAt", System.currentTimeMillis())
                    .remove("$userId.lastPushTokenRefreshError")
                    .commit()
            } catch (error: Exception) {
                allSucceeded = false
                prefs.edit()
                    .putLong("$userId.lastPushTokenRefreshAt", System.currentTimeMillis())
                    .putString(
                        "$userId.lastPushTokenRefreshError",
                        (error.message ?: error.javaClass.simpleName).take(1_000),
                    )
                    .commit()
                Log.w("FoxChatPushToken", "Could not refresh pusher for ${privateRef("user", userId)}", error)
            }
        }
        return allSucceeded
    }

    private fun refreshPusherForAccount(
        prefs: android.content.SharedPreferences,
        userId: String,
        firebaseToken: String,
    ) = synchronized(lockFor(userId)) {
        val deviceId = prefs.getString("$userId.device", null)
            ?: error("Native device ID is missing")
        val homeserver = prefs.getString("$userId.homeserver", null)
            ?: error("Native homeserver is missing")
        var accessToken = prefs.getString("$userId.token", null)
            ?: error("Native access token is missing")
        val clearToken = prefs.getString("$userId.pushClearToken", null)
            ?: error("Native push clear token is not cached yet")
        val gatewayUrl = prefs.getString("$userId.pushGatewayUrl", null)
            ?.trimEnd('/')
            ?: error("Native push gateway URL is not cached yet")
        try {
            updatePusherForAccount(
                homeserver, accessToken, deviceId, clearToken, gatewayUrl, firebaseToken,
            )
        } catch (error: NativePusherRequestException) {
            if (error.httpStatus != 401) throw error
            // The Matrix SDK owns token refresh while its WebView is alive. Let
            // the persisted job retry instead of racing and rotating the same
            // refresh token in two independent clients.
            if (NativeCryptoBridge.webViewActive) throw error
            accessToken = refreshNativeSession(prefs, userId, homeserver)
            updatePusherForAccount(
                homeserver, accessToken, deviceId, clearToken, gatewayUrl, firebaseToken,
            )
        }
    }

    private fun updatePusherForAccount(
        homeserver: String,
        accessToken: String,
        deviceId: String,
        clearToken: String,
        gatewayUrl: String,
        firebaseToken: String,
    ) {
        val pushers = matrixJsonRequest(
            "$homeserver/_matrix/client/v3/pushers",
            accessToken,
            "GET",
        ).optJSONArray("pushers") ?: JSONArray()
        for (index in 0 until pushers.length()) {
            val pusher = pushers.optJSONObject(index) ?: continue
            if (
                pusher.optString("app_id") != "foxchat.jakefox.de" ||
                pusher.optString("kind") != "http" ||
                pusher.optString("profile_tag") != deviceId ||
                pusher.optString("pushkey") == firebaseToken
            ) continue
            matrixJsonRequest(
                "$homeserver/_matrix/client/v3/pushers/set",
                accessToken,
                "POST",
                JSONObject()
                    .put("app_id", "foxchat.jakefox.de")
                    .put("pushkey", pusher.getString("pushkey"))
                    .put("kind", JSONObject.NULL),
            )
        }
        matrixJsonRequest(
            "$homeserver/_matrix/client/v3/pushers/set",
            accessToken,
            "POST",
            JSONObject()
                .put("app_id", "foxchat.jakefox.de")
                .put("pushkey", firebaseToken)
                .put("kind", "http")
                .put("app_display_name", "FoxChat")
                .put("device_display_name", "FoxChat Android")
                .put("lang", Locale.getDefault().toLanguageTag())
                .put("profile_tag", deviceId)
                .put("append", true)
                .put(
                    "data",
                    JSONObject()
                        .put("url", "$gatewayUrl/_matrix/push/v1/notify")
                        .put("format", "event_id_only")
                        .put("client_name", "FoxChat android")
                        .put("data_message", "android")
                        .put("clear_token", clearToken),
                ),
        )
    }

    private fun refreshNativeSession(
        prefs: android.content.SharedPreferences,
        userId: String,
        homeserver: String,
    ): String {
        val refreshToken = prefs.getString("$userId.refreshToken", null)
            ?: error("Native Matrix access token expired and no refresh token is cached")
        val response = matrixJsonRequest(
            "$homeserver/_matrix/client/v3/refresh",
            accessToken = null,
            method = "POST",
            body = JSONObject().put("refresh_token", refreshToken),
        )
        val accessToken = response.optString("access_token")
            .takeIf { it.isNotBlank() }
            ?: error("Matrix session refresh returned no access token")
        val nextRefreshToken = response.optString("refresh_token")
            .takeIf { it.isNotBlank() }
            ?: refreshToken
        val expiresIn = response.optLong("expires_in_ms", 0L)
        prefs.edit()
            .putString("$userId.token", accessToken)
            .putString("$userId.refreshToken", nextRefreshToken)
            .putLong(
                "$userId.accessTokenExpiresAt",
                if (expiresIn > 0) System.currentTimeMillis() + expiresIn else 0L,
            )
            .putLong("$userId.nativeSessionRefreshAt", System.currentTimeMillis())
            .commit()
        return accessToken
    }

    fun nativeSessionTokens(context: Context, userId: String): JSONObject {
        val prefs = preferences(context)
        val refreshedAt = prefs.getLong("$userId.nativeSessionRefreshAt", 0L)
        if (refreshedAt <= 0) return JSONObject()
        return JSONObject()
            .put("accessToken", prefs.getString("$userId.token", null))
            .put("refreshToken", prefs.getString("$userId.refreshToken", null))
            .put("accessTokenExpiresAt", prefs.getLong("$userId.accessTokenExpiresAt", 0L))
            .put("refreshedAt", refreshedAt)
    }

    private fun matrixJsonRequest(
        url: String,
        accessToken: String?,
        method: String,
        body: JSONObject? = null,
    ): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            if (!accessToken.isNullOrBlank()) {
                connection.setRequestProperty("Authorization", "Bearer $accessToken")
            }
            connection.setRequestProperty("Content-Type", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.bufferedWriter().use { it.write(body.toString()) }
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                val details = connection.errorStream?.bufferedReader()?.use { it.readText() }
                    ?.take(500)
                    .orEmpty()
                throw NativePusherRequestException(status, details)
            }
            val response = connection.inputStream.bufferedReader().use { it.readText() }
            return if (response.isBlank()) JSONObject() else JSONObject(response)
        } finally {
            connection.disconnect()
        }
    }

    fun roomName(context: Context, roomId: String): String =
        preferences(context).getString("room.$roomId.name", "FoxChat") ?: "FoxChat"

    fun roomAvatarFile(context: Context, roomId: String): File? =
        File(context.noBackupFilesDir, "notification-room-avatars/${safeName(roomId)}.img")
            .takeIf { it.isFile && it.length() > 0 }

    private fun notificationAppearance(context: Context): JSONObject = try {
        JSONObject(
            context.getSharedPreferences("foxchat_notification_preferences", Context.MODE_PRIVATE)
                .getString("timelineAppearance", "{}") ?: "{}",
        )
    } catch (_: Exception) {
        JSONObject()
    }

    private fun activeCallMembership(content: JSONObject): Boolean {
        if (
            content.optString("application") == "m.call" &&
            content.optString("membershipID").isNotBlank()
        ) return content.optLong("expires", 1L) > 0L
        val application = content.optJSONObject("application")
        val member = content.optJSONObject("member")
        return application?.optString("type") == "m.call" &&
            !member?.optString("id").isNullOrBlank() &&
            content.optJSONArray("rtc_transports") != null
    }

    private fun suppressTimelineActivity(context: Context, event: JSONObject): Boolean {
        val type = event.optString("type")
        val content = event.optJSONObject("content") ?: JSONObject()
        val previous = event.optJSONObject("unsigned")?.optJSONObject("prev_content")
            ?: event.optJSONObject("prev_content")
            ?: JSONObject()
        val settings = notificationAppearance(context)
        val enabled = mutableListOf<Boolean>()
        if (type == "m.room.member") {
            val membership = content.optString("membership")
            val previousMembership = previous.optString("membership")
            if ((membership == "join" || membership == "leave") && membership != previousMembership) {
                enabled.add(settings.optBoolean("roomMembership", true))
            } else if (membership == "join" && previousMembership == "join") {
                if (content.optString("displayname") != previous.optString("displayname")) {
                    enabled.add(settings.optBoolean("displayName", true))
                }
                if (content.optString("avatar_url") != previous.optString("avatar_url")) {
                    enabled.add(settings.optBoolean("avatar", true))
                }
            }
        }
        if (
            type == "org.matrix.msc3401.call.member" ||
            type == "m.call.member" ||
            type == "org.matrix.msc4143.rtc.member"
        ) {
            if (activeCallMembership(content) != activeCallMembership(previous)) {
                enabled.add(settings.optBoolean("voiceMembership", true))
            }
        }
        return enabled.isNotEmpty() && enabled.none { it }
    }

    fun decrypt(
        context: Context,
        roomId: String,
        eventId: String,
        knownSenderId: String? = null,
        knownSenderName: String? = null,
    ): NativeDecryptedNotification {
        val prefs = preferences(context)
        val preferredUserId = prefs.getString("room.$roomId", null)
        val userIds = buildList {
            if (!preferredUserId.isNullOrBlank()) add(preferredUserId)
            addAll(prefs.getStringSet("room.$roomId.accounts", emptySet()).orEmpty())
        }.distinct().filter { prefs.contains("$it.device") }
        if (userIds.isEmpty()) {
            throw IllegalStateException("No native room-account mapping exists for $roomId")
        }

        val errors = mutableListOf<Exception>()
        for (userId in userIds) {
            try {
                val result = decryptWithAccount(
                    context,
                    prefs,
                    userId,
                    roomId,
                    eventId,
                    knownSenderId,
                    knownSenderName,
                )
                prefs.edit()
                    .putLong("$userId.lastDecryptAt", System.currentTimeMillis())
                    .remove("$userId.lastDecryptError")
                    .apply()
                return result
            } catch (error: Exception) {
                errors.add(error)
            }
        }
        val message = errors.joinToString(" | ") { it.message ?: it.javaClass.simpleName }
        for (userId in userIds) {
            prefs.edit()
                .putLong("$userId.lastDecryptAt", System.currentTimeMillis())
                .putString("$userId.lastDecryptError", message)
                .apply()
        }
        // Keep Matrix request metadata in the diagnostic when possible.
        throw errors.filterIsInstance<MatrixRequestException>().firstOrNull()
            ?: errors.firstOrNull()
            ?: IllegalStateException("No account could decrypt this notification")
    }

    private fun decryptWithAccount(
        context: Context,
        prefs: android.content.SharedPreferences,
        userId: String,
        roomId: String,
        eventId: String,
        knownSenderId: String?,
        knownSenderName: String?,
    ): NativeDecryptedNotification =
        synchronized(lockFor(userId)) {
            val deviceId = prefs.getString("$userId.device", null) ?: error("Native device ID is missing")
            val homeserver = prefs.getString("$userId.homeserver", null) ?: error("Native homeserver is missing")
            val token = prefs.getString("$userId.token", null) ?: error("Native access token is missing")
            val connection = URL("$homeserver/_matrix/client/v3/rooms/${encode(roomId)}/event/${encode(eventId)}")
                .openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 7_000
                connection.readTimeout = 7_000
                connection.setRequestProperty("Authorization", "Bearer $token")
                if (connection.responseCode !in 200..299) throw IllegalStateException("Homeserver event fetch failed with HTTP ${connection.responseCode}")
                val raw = connection.inputStream.bufferedReader().use { it.readText() }
                val encrypted = JSONObject(raw)
                val clear = if (encrypted.optString("type") == "m.room.encrypted") {
                    val olmMachine = machine(context, userId, deviceId)
                    val decrypted = try {
                        olmMachine.decryptRoomEvent(
                            raw, roomId, false, false,
                            DecryptionSettings(TrustRequirement.UNTRUSTED),
                        )
                    } catch (missing: DecryptionException.MissingRoomKey) {
                        restoreSessionFromBackup(
                            context,
                            userId,
                            roomId,
                            encrypted.optJSONObject("content")?.optString("session_id")
                                ?.takeIf { it.isNotBlank() }
                                ?: throw missing,
                            olmMachine,
                        )
                        olmMachine.decryptRoomEvent(
                            raw, roomId, false, false,
                            DecryptionSettings(TrustRequirement.UNTRUSTED),
                        )
                    }
                    JSONObject(decrypted.clearEvent)
                } else {
                    encrypted
                }
                if (suppressTimelineActivity(context, clear)) {
                    val senderId = encrypted.optString("sender")
                    return@synchronized NativeDecryptedNotification(
                        senderId = senderId,
                        senderName = senderId,
                        body = "",
                        timestamp = encrypted.optLong("origin_server_ts", System.currentTimeMillis()),
                        suppressed = true,
                    )
                }
                val content = clear.optJSONObject("content") ?: error("Decrypted event has no content")
                val body = content.optString("body").takeIf { it.isNotBlank() }
                    ?: when (clear.optString("type")) {
                        "m.sticker" -> "Sent a sticker"
                        else -> "Sent an encrypted message"
                    }
                val senderId = encrypted.optString("sender")
                val senderName = knownSenderName?.takeIf {
                    senderId == knownSenderId && it.isNotBlank() && it != senderId
                } ?: fetchSenderDisplayName(homeserver, token, roomId, senderId)
                NativeDecryptedNotification(
                    senderId = senderId,
                    senderName = senderName,
                    body = body,
                    timestamp = encrypted.optLong("origin_server_ts", System.currentTimeMillis()),
                )
            } finally {
                connection.disconnect()
            }
        }

    private fun fetchSenderDisplayName(
        homeserver: String,
        token: String,
        roomId: String,
        senderId: String,
    ): String {
        if (senderId.isBlank()) return "Someone"
        return try {
            val member = fetchJson(
                "$homeserver/_matrix/client/v3/rooms/${encode(roomId)}/state/m.room.member/${encode(senderId)}",
                token,
                "sender-profile",
            )
            member.optString("displayname").takeIf { it.isNotBlank() } ?: senderId
        } catch (error: Exception) {
            Log.w("FoxChatNativeCrypto", "Could not resolve display name for $senderId in $roomId", error)
            senderId
        }
    }

    private fun restoreSessionFromBackup(
        context: Context,
        userId: String,
        roomId: String,
        sessionId: String,
        olmMachine: OlmMachine,
    ) {
        val prefs = preferences(context)
        val homeserver = prefs.getString("$userId.homeserver", null)
            ?: error("Native homeserver is missing")
        val token = prefs.getString("$userId.token", null)
            ?: error("Native access token is missing")
        val version = prefs.getString("$userId.backupVersion", null)
            ?: error("No trusted key-backup version is available natively")
        val encodedRecoveryKey = prefs.getString("$userId.backupRecoveryKey", null)
            ?: error("No trusted key-backup recovery key is available natively")
        val recoveryKey = BackupRecoveryKey.fromBase64(encodedRecoveryKey)
        try {
            val backupInfo = fetchJson(
                "$homeserver/_matrix/client/v3/room_keys/version/${encode(version)}",
                token,
                "key-backup-version",
            )
            val expectedPublicKey = backupInfo.optJSONObject("auth_data")
                ?.optString("public_key")
                ?.takeIf { it.isNotBlank() }
                ?: error("Key backup has no public key")
            if (recoveryKey.megolmV1PublicKey().publicKey != expectedPublicKey)
                error("Stored recovery key does not match key backup $version")

            val session = fetchJson(
                "$homeserver/_matrix/client/v3/room_keys/keys/${encode(roomId)}/${encode(sessionId)}?version=${encode(version)}",
                token,
                "key-backup-session",
            )
            val data = session.optJSONObject("session_data")
                ?: error("Backed-up session has no encrypted session data")
            val clear = JSONObject(
                recoveryKey.decryptV1(
                    data.getString("ephemeral"),
                    data.getString("mac"),
                    data.getString("ciphertext"),
                ),
            )
                .put("room_id", roomId)
                .put("session_id", sessionId)
            olmMachine.importRoomKeysFromBackup(
                JSONArray().put(clear).toString(),
                version,
                object : ProgressListener {
                    override fun onProgress(progress: Int, total: Int) = Unit
                },
            )
            recordNotificationDiagnostic(context, "backup-key-imported", roomId, sessionId)
        } finally {
            recoveryKey.close()
        }
    }

    private fun fetchJson(url: String, accessToken: String, requestStage: String): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 7_000
            connection.readTimeout = 7_000
            connection.setRequestProperty("Authorization", "Bearer $accessToken")
            val status = connection.responseCode
            if (status !in 200..299) {
                val errorBody = try {
                    connection.errorStream?.bufferedReader()?.use { it.readText() }
                } catch (_: Exception) {
                    null
                }
                val matrixError = try {
                    errorBody?.let(::JSONObject)
                } catch (_: Exception) {
                    null
                }
                throw MatrixRequestException(
                    requestStage,
                    status,
                    matrixError?.optString("errcode")?.takeIf { it.isNotBlank() },
                    matrixError?.optString("error")?.takeIf { it.isNotBlank() },
                )
            }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    fun status(context: Context): JSONObject {
        val prefs = preferences(context)
        val accounts = JSONArray()
        val storedUsers = prefs.all.keys.filter { it.endsWith(".device") }.map { it.removeSuffix(".device") }
        val pendingUsers = prefs.all.keys.filter { it.startsWith("setup.") && it.endsWith(".state") }
            .map { it.removePrefix("setup.").removeSuffix(".state") }
        val userIds = (storedUsers + pendingUsers).distinct().sorted()
        for (userId in userIds) {
            val setupState = prefs.getString("setup.$userId.state", "not-started")
            val setupStartedAt = prefs.getLong("setup.$userId.startedAt", 0)
            val setupHeartbeatAt = prefs.getLong("setup.$userId.heartbeatAt", setupStartedAt)
            val setupPhase = prefs.getString("setup.$userId.phase", "unknown")
            val setupError = prefs.getString("setup.$userId.error", null)
                ?: if (setupState == "pending" && setupHeartbeatAt > 0 && System.currentTimeMillis() - setupHeartbeatAt > 120_000)
                    "Native crypto setup stopped responding during: $setupPhase"
                else null
            val setupErrorDetails = prefs.getString("setup.$userId.errorDetails", null)
            accounts.put(JSONObject()
            .put("userId", userId)
            .put("deviceId", prefs.getString("$userId.device", ""))
            .put("lastSyncAt", prefs.getLong("$userId.lastSyncAt", 0))
            .put("exportedSessions", prefs.getInt("$userId.exported", 0))
            .put("importedSessions", prefs.getLong("$userId.imported", 0))
            .put("importTotal", prefs.getLong("$userId.importTotal", 0))
            .put("lastDecryptAt", prefs.getLong("$userId.lastDecryptAt", 0))
            .put("lastPushTokenRefreshAt", prefs.getLong("$userId.lastPushTokenRefreshAt", 0))
            .put(
                "lastPushTokenRefreshError",
                prefs.getString("$userId.lastPushTokenRefreshError", null),
            )
            .put("nativeSessionRefreshAt", prefs.getLong("$userId.nativeSessionRefreshAt", 0))
            .put("lastSyncError", prefs.getString("$userId.lastSyncError", null))
            .put(
                "lastDecryptError",
                prefs.getString("$userId.lastDecryptError", null)
                    ?: prefs.getString("$userId.lastError", null),
            )
            .put(
                "backupConfigured",
                !prefs.getString("$userId.backupVersion", null).isNullOrBlank() &&
                    !prefs.getString("$userId.backupRecoveryKey", null).isNullOrBlank(),
            )
            .put("setupState", setupState)
            .put("setupStartedAt", setupStartedAt)
            .put("setupHeartbeatAt", setupHeartbeatAt)
            .put("setupPhase", setupPhase)
            .put("setupError", setupError)
            .put("setupErrorDetails", setupErrorDetails))
        }
        val boot = context.getSharedPreferences("foxchat_boot_diagnostics", Context.MODE_PRIVATE)
        return JSONObject()
            .put("available", true)
            .put("enabled", isEnabled(context))
            .put("bootStage", boot.getString("stage", "unknown"))
            .put("bootStageAt", boot.getLong("at", 0))
            .put("notificationDiagnostics", sanitizedDiagnostics(prefs))
            .put("accounts", accounts)
    }

    private fun sanitizedDiagnostics(prefs: android.content.SharedPreferences): JSONArray {
        val source = try {
            JSONArray(prefs.getString("notificationDiagnostics", "[]"))
        } catch (_: Exception) {
            JSONArray()
        }
        val result = JSONArray()
        for (index in 0 until source.length()) {
            val item = source.optJSONObject(index) ?: continue
            val copy = JSONObject(item.toString())
            val roomId = copy.optString("roomId")
            copy.remove("roomId")
            if (roomId.isNotBlank()) copy.put("roomRef", privateRef("room", roomId))
            result.put(copy)
        }
        return result
    }

    private fun privateRef(kind: String, value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return "$kind:${digest.take(8).joinToString("") { "%02x".format(it) }}"
    }

    private fun machine(context: Context, userId: String, deviceId: String): OlmMachine =
        machines.getOrPut(userId) {
            val prefs = preferences(context)
            val store = File(context.noBackupFilesDir, "matrix-notification-crypto/${safeName(userId)}")
            if (prefs.getInt("$userId.storeVersion", 0) < STORE_VERSION) {
                // The WebView store remains authoritative.
                if (store.exists() && !store.deleteRecursively()) {
                    error("Could not reset the previous native crypto store")
                }
                prefs.edit()
                    .remove("$userId.passphrase")
                    .putInt("$userId.storeVersion", STORE_VERSION)
                    .commit()
            }
            var passphrase = prefs.getString("$userId.passphrase", null)
            if (passphrase == null) {
                val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
                passphrase = Base64.encodeToString(bytes, Base64.NO_WRAP)
                prefs.edit().putString("$userId.passphrase", passphrase).commit()
            }
            store.mkdirs()
            OlmMachine(userId, deviceId, store.absolutePath, passphrase)
        }

    private fun preferences(context: Context) = EncryptedSharedPreferences.create(
        context,
        PREFS,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    ).also { prefs ->
        val version = BuildConfig.VERSION_CODE.toLong()
        if (prefs.getLong("notificationDiagnosticsVersion", -1L) != version) {
            prefs.edit()
                .remove("notificationDiagnostics")
                .putLong("notificationDiagnosticsVersion", version)
                .commit()
        }
    }

    private fun lockFor(userId: String) = locks.getOrPut(userId) { Any() }
    private fun safeName(value: String) = value.toByteArray().joinToString("") { "%02x".format(it) }
    private fun encode(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}
