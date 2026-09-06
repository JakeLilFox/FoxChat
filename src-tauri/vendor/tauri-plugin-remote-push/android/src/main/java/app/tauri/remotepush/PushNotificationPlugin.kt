package app.tauri.remotepush

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.util.Log
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private val mainScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

/**
 * Lets the app module (which owns notification rendering, and which the plugin module
 * cannot depend on - dependencies only flow app -> plugin) register a handler here without
 * a compile-time reference. FoxChatMessagingService sets this once, before it ever asks the
 * webview to decrypt anything, so it is always populated by the time a response arrives.
 */
object NotificationDecryptionBridge {
    var onDecrypted: ((roomId: String, eventId: String, senderId: String, senderName: String, body: String, roomName: String?) -> Unit)? = null
    var onCompleted: ((roomId: String, eventId: String) -> Unit)? = null

    // Lets NotificationDecryptService know the instant a specific decrypt round-trip
    // finishes, so it can stop its foreground service right away instead of always waiting
    // out its full timeout.
    private val waiters = java.util.concurrent.ConcurrentHashMap<String, () -> Unit>()
    private fun key(roomId: String, eventId: String) = "$roomId\u0000$eventId"

    fun awaitCompletion(roomId: String, eventId: String, onComplete: () -> Unit) {
        waiters[key(roomId, eventId)] = onComplete
    }

    fun cancelAwait(roomId: String, eventId: String) {
        waiters.remove(key(roomId, eventId))
    }

    fun notifyCompletion(roomId: String, eventId: String) {
        waiters.remove(key(roomId, eventId))?.invoke()
    }
}

/** App-owned hook because the reusable push plugin must not depend on FoxChat's crypto AAR. */
object NativeCryptoBridge {
    @Volatile var webViewActive = false
    var sync: ((String, String, String, String, String?, String, String, String?, String?, String?, String?) -> Unit)? = null
    var status: (() -> String)? = null
    var test: ((String, String) -> String)? = null
    var sessionTokens: ((String) -> String)? = null
    /** Android app-owned Matrix Rust SDK dispatcher; kept generic so this plugin stays reusable. */
    var matrix: (suspend (action: String, payload: String) -> String)? = null
    /** App-owned durable logger for native failures that may also surface as WebView toasts. */
    var recordError: ((context: String, error: Throwable) -> Unit)? = null
}

object NotificationDebugBridge {
    var showAndroidAutoTest: ((String, String, String, String) -> Unit)? = null
}

/**
 * Dismissing a room's notification has to clear its stored conversation history too, or the
 * next message in that room resurrects already-read messages back into the notification.
 * Shared here (instead of only in FoxChatNotificationActionService) so the native "mark as
 * read"/"reply" actions and the in-app "you read this room" path from clearRoomNotification
 * stay in sync instead of drifting into two different clear implementations.
 */
object RoomNotificationStore {
    // Must match FoxChatMessagingService.kt's MESSAGE_STORE constant - same on-disk file.
    private const val MESSAGE_STORE = "foxchat_notification_messages"

    private const val MAX_STORED_MESSAGES = 10

    @Synchronized
    fun clear(context: Context, roomId: String) {
        context.getSharedPreferences(MESSAGE_STORE, Context.MODE_PRIVATE).edit().remove(roomId).commit()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(roomId, roomId.hashCode())
    }

    @Synchronized
    fun contains(context: Context, roomId: String, eventId: String): Boolean {
        val array = read(context, roomId)
        return (0 until array.length()).any { array.optJSONObject(it)?.optString("event_id") == eventId }
    }

    @Synchronized
    fun append(
        context: Context,
        roomId: String,
        eventId: String,
        senderId: String,
        senderName: String,
        body: String,
        timestamp: Long,
    ): List<JSONObject> {
        val array = read(context, roomId)
        val messages = mutableListOf<JSONObject>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            if (item.optString("event_id") != eventId) messages.add(item)
        }
        messages.add(JSONObject().apply {
            put("event_id", eventId)
            put("sender_id", senderId)
            put("sender_name", senderName)
            put("body", body)
            put("timestamp", timestamp)
        })
        val trimmed = messages.takeLast(MAX_STORED_MESSAGES)
        context.getSharedPreferences(MESSAGE_STORE, Context.MODE_PRIVATE)
            .edit().putString(roomId, JSONArray(trimmed).toString()).commit()
        return trimmed
    }

    private fun read(context: Context, roomId: String): JSONArray = try {
        JSONArray(context.getSharedPreferences(MESSAGE_STORE, Context.MODE_PRIVATE).getString(roomId, "[]"))
    } catch (_: Exception) {
        JSONArray()
    }
}

@TauriPlugin(
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")]
)
class PushNotificationPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        var instance: PushNotificationPlugin? = null
    }

    override fun load(webView: WebView) {
        super.load(webView)
        instance = this
    }

    @Command
    fun getToken(invoke: Invoke) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                invoke.reject("Failed to get FCM token", task.exception)
                return@addOnCompleteListener
            }
            val result = JSObject()
            result.put("token", task.result)
            invoke.resolve(result)
        }
    }

    @Command
    override fun requestPermissions(invoke: Invoke) {
        mainScope.launch {
            requestPermissionForAlias("notifications", invoke, "requestPermissionsCallback")
        }
    }

    @app.tauri.annotation.PermissionCallback
    fun requestPermissionsCallback(invoke: Invoke) {
        val permissions = JSObject()
        val state = getPermissionState("notifications")
        permissions.put("permissionState", state.toString().lowercase())
        trigger("permissionStateChange", permissions)
        invoke.resolve()
    }

    fun handleNewToken(token: String) {
        val data = JSObject()
        data.put("token", token)
        trigger("token-received", data)
    }

    fun handleNativeMatrixSessionChanged(userId: String, accessToken: String, refreshToken: String?) {
        val data = JSObject()
        data.put("userId", userId)
        data.put("accessToken", accessToken)
        data.put("refreshToken", refreshToken)
        trigger("native-matrix-session-changed", data)
    }

    /** Publishes a decrypted Rust timeline event to a currently alive WebView. */
    fun handleNativeMatrixEvent(event: JSONObject) {
        trigger("native-matrix-event", JSObject(event.toString()))
    }

    fun handleNativeMatrixRoomsChanged(userId: String) {
        val data = JSObject()
        data.put("userId", userId)
        trigger("native-matrix-rooms-changed", data)
    }

    /** Publishes retained verification state from the process-wide Rust client. */
    fun handleNativeMatrixVerification(event: JSONObject) {
        trigger("native-matrix-verification", JSObject(event.toString()))
    }

    fun handleMessage(message: RemoteMessage) {
        val data = JSObject()
        message.notification?.let {
            val notification = JSObject()
            notification.put("title", it.title)
            notification.put("body", it.body)
            data.put("notification", notification)
        }
        data.put("data", message.data)
        trigger("notification-received", data)
    }

    /** Asks the webview (if one is currently alive) to decrypt this event and call updateNotification back. */
    fun requestDecryption(roomId: String, eventId: String) {
        val data = JSObject()
        data.put("roomId", roomId)
        data.put("eventId", eventId)
        trigger("notification-decrypt-request", data)
    }

    @Command
    fun updateNotification(invoke: Invoke) {
        val args = invoke.getArgs()
        val roomId = args.getString("roomId")
        val eventId = args.getString("eventId")
        val suppress = args.getBoolean("suppress", false)
        if (suppress) {
            NotificationDecryptionBridge.onCompleted?.invoke(roomId, eventId)
            NotificationDecryptionBridge.notifyCompletion(roomId, eventId)
            invoke.resolve()
            return
        }
        val senderId = args.getString("senderId")
        val body = args.getString("body")
        if (roomId.isEmpty() || eventId.isEmpty() || body.isEmpty()) {
            invoke.reject("roomId, eventId and body are required")
            return
        }
        val senderName = args.getString("senderName", senderId) ?: senderId
        val roomName = args.getString("roomName", null)
        NotificationDecryptionBridge.onDecrypted?.invoke(roomId, eventId, senderId, senderName, body, roomName)
        NotificationDecryptionBridge.onCompleted?.invoke(roomId, eventId)
        NotificationDecryptionBridge.notifyCompletion(roomId, eventId)
        invoke.resolve()
    }

    @Command
    fun syncNativeCrypto(invoke: Invoke) {
        val args = invoke.getArgs()
        val userId = args.getString("userId")
        val deviceId = args.getString("deviceId")
        val homeserver = args.getString("homeserver")
        val accessToken = args.getString("accessToken")
        val refreshToken = args.getString("refreshToken", null)
        val roomKeys = args.getString("roomKeys")
        val rooms = args.getString("rooms")
        val backupVersion = args.getString("backupVersion", null)
        val backupRecoveryKey = args.getString("backupRecoveryKey", null)
        val pushClearToken = args.getString("pushClearToken", null)
        val pushGatewayUrl = args.getString("pushGatewayUrl", null)
        val notificationPreferences = args.getString("notificationPreferences", null)
        if (userId.isEmpty() || deviceId.isEmpty() || homeserver.isEmpty() || accessToken.isEmpty() || roomKeys.isEmpty() || rooms.isEmpty()) {
            invoke.reject("userId, deviceId, homeserver, accessToken, roomKeys and rooms are required")
            return
        }
        val handler = NativeCryptoBridge.sync
        if (handler == null) {
            invoke.reject("Native crypto is unavailable")
            return
        }
        if (!notificationPreferences.isNullOrBlank()) {
            activity.applicationContext
                .getSharedPreferences("foxchat_notification_preferences", Context.MODE_PRIVATE)
                .edit()
                .putString("timelineAppearance", notificationPreferences)
                .commit()
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                handler(
                    userId, deviceId, homeserver, accessToken, refreshToken, roomKeys, rooms,
                    backupVersion, backupRecoveryKey, pushClearToken, pushGatewayUrl,
                )
                invoke.resolve()
            } catch (error: Exception) {
                NativeCryptoBridge.recordError?.invoke("native-crypto-sync", error)
                invoke.reject("Could not sync native crypto", error)
            }
        }
    }

    @Command
    fun nativeSessionTokens(invoke: Invoke) {
        val userId = invoke.getArgs().getString("userId")
        if (userId.isEmpty()) {
            invoke.reject("userId is required")
            return
        }
        try {
            val raw = NativeCryptoBridge.sessionTokens?.invoke(userId)
                ?: throw IllegalStateException("Native session tokens are unavailable")
            invoke.resolve(JSObject(raw))
        } catch (error: Exception) {
            NativeCryptoBridge.recordError?.invoke("native-session-tokens", error)
            invoke.reject("Could not read native session tokens", error)
        }
    }

    @Command
    fun nativeCryptoStatus(invoke: Invoke) {
        try {
            val raw = NativeCryptoBridge.status?.invoke() ?: throw IllegalStateException("Native crypto is unavailable")
            invoke.resolve(JSObject(raw))
        } catch (error: Exception) {
            NativeCryptoBridge.recordError?.invoke("native-status", error)
            invoke.reject("Could not read native crypto status", error)
        }
    }

    @Command
    fun testNativeCrypto(invoke: Invoke) {
        val roomId = invoke.getArgs().getString("roomId")
        val eventId = invoke.getArgs().getString("eventId")
        if (roomId.isEmpty() || eventId.isEmpty()) {
            invoke.reject("roomId and eventId are required")
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val raw = NativeCryptoBridge.test?.invoke(roomId, eventId)
                    ?: throw IllegalStateException("Native crypto is unavailable")
                invoke.resolve(JSObject(raw))
            } catch (error: Exception) {
                NativeCryptoBridge.recordError?.invoke("native-decryption-test", error)
                invoke.reject(error.message ?: "Native decryption test failed", error)
            }
        }
    }

    @Command
    fun nativeMatrix(invoke: Invoke) {
        val action = invoke.getArgs().getString("action")
        val payload = invoke.getArgs().getString("payload", "{}") ?: "{}"
        if (action.isEmpty()) {
            invoke.reject("action is required")
            return
        }
        val handler = NativeCryptoBridge.matrix
        if (handler == null) {
            invoke.reject("Native Matrix is unavailable")
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                invoke.resolve(JSObject(handler(action, payload)))
            } catch (error: Exception) {
                NativeCryptoBridge.recordError?.invoke("native-matrix:$action", error)
                Log.e("FoxChatNativeMatrix", "Native Matrix command $action failed", error)
                invoke.reject(error.message ?: "Native Matrix command failed", error)
            }
        }
    }

    @Command
    fun clearRoomNotification(invoke: Invoke) {
        val roomId = invoke.getArgs().getString("roomId")
        if (roomId.isEmpty()) {
            invoke.reject("roomId is required")
            return
        }
        RoomNotificationStore.clear(activity.applicationContext, roomId)
        invoke.resolve()
    }

    @Command
    fun testAndroidAutoNotification(invoke: Invoke) {
        val args = invoke.getArgs()
        val roomId = args.getString("roomId")
        val roomName = args.getString("roomName", "Android Auto test") ?: "Android Auto test"
        val senderName = args.getString("senderName", "FoxChat test") ?: "FoxChat test"
        val body = args.getString("body", "Reply to this message to test Android Auto") ?: "Reply to this message to test Android Auto"
        if (roomId.isEmpty()) {
            invoke.reject("roomId is required")
            return
        }
        val handler = NotificationDebugBridge.showAndroidAutoTest
        if (handler == null) {
            invoke.reject("Android Auto notification testing is unavailable")
            return
        }
        handler(roomId, roomName, senderName, body)
        invoke.resolve()
    }
}
