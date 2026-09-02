package foxchat.jakefox.de

import android.app.IntentService
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import app.tauri.remotepush.RoomNotificationStore
import org.json.JSONArray
import org.json.JSONObject

private const val REPLY_ACTION = "foxchat.action.REPLY"
private const val MARK_READ_ACTION = "foxchat.action.MARK_READ"
private const val DISMISS_ACTION = "foxchat.action.DISMISS"
private const val REPLY_INPUT_KEY = "foxchat.reply.TEXT"
private const val PENDING_REPLY_STORE = "foxchat_pending_notification_replies"
private const val PENDING_REPLIES_KEY = "replies"
private const val NATIVE_REPLY_BROADCAST = "foxchat.action.NATIVE_REPLY_READY"

@Suppress("DEPRECATION")
class FoxChatNotificationActionService : IntentService("FoxChatNotificationActionService") {
    override fun onHandleIntent(intent: Intent?) {
        if (intent == null) return
        val roomId = intent.getStringExtra("room_id") ?: return
        if (intent.action == REPLY_ACTION) {
            val text = RemoteInput.getResultsFromIntent(intent)
                ?.getCharSequence(REPLY_INPUT_KEY)
                ?.toString()
                ?.trim()
                .orEmpty()
            if (text.isEmpty()) return
            NativeNotificationCrypto.recordNotificationDiagnostic(
                applicationContext,
                "android-auto-reply-received",
                roomId,
                "reply:${System.currentTimeMillis()}",
            )
            val sentNatively = runCatching {
                NativeMatrixClientManager.sendRawForRoom(
                    applicationContext,
                    roomId,
                    "m.room.message",
                    JSONObject().put("msgtype", "m.text").put("body", text).toString(),
                )
            }.isSuccess
            if (!sentNatively) {
                queueReply(roomId, text)
                sendBroadcast(Intent(NATIVE_REPLY_BROADCAST).setPackage(packageName))
            }
        } else if (intent.action == MARK_READ_ACTION) {
            NativeNotificationCrypto.recordNotificationDiagnostic(
                applicationContext,
                "android-auto-mark-read-received",
                roomId,
                "mark-read:${System.currentTimeMillis()}",
            )
            runCatching { NativeMatrixClientManager.markReadForRoom(applicationContext, roomId) }
        } else if (intent.action != DISMISS_ACTION) return
        RoomNotificationStore.clear(applicationContext, roomId)
    }

    private fun queueReply(roomId: String, text: String) {
        val preferences = getSharedPreferences(PENDING_REPLY_STORE, Context.MODE_PRIVATE)
        val replies = try { JSONArray(preferences.getString(PENDING_REPLIES_KEY, "[]")) }
        catch (_: Exception) { JSONArray() }
        replies.put(JSONObject()
            .put("id", "${System.currentTimeMillis()}:${roomId.hashCode()}")
            .put("roomId", roomId)
            .put("text", text))
        val trimmed = JSONArray()
        for (index in maxOf(0, replies.length() - 20) until replies.length()) trimmed.put(replies.get(index))
        preferences.edit().putString(PENDING_REPLIES_KEY, trimmed.toString()).commit()
    }
}
