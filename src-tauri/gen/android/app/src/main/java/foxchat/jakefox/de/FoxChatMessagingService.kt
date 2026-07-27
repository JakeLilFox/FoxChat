package foxchat.jakefox.de

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import app.tauri.remotepush.NotificationDecryptionBridge
import app.tauri.remotepush.RoomNotificationStore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
private const val MARK_READ_ACTION = "foxchat.action.MARK_READ"
private const val REPLY_ACTION = "foxchat.action.REPLY"
private const val DISMISS_ACTION = "foxchat.action.DISMISS"
private const val REPLY_INPUT_KEY = "foxchat.reply.TEXT"
private const val ROOM_ID_EXTRA = "room_id"
const val MESSAGE_NOTIFICATION_CHANNEL_ID = "messages_v2"
const val SILENT_NOTIFICATION_CHANNEL_ID = "messages_silent"

class FoxChatMessagingService : FirebaseMessagingService() {
    companion object {
        // FCM receives event IDs while FoxChat decrypts content locally.
        private var bridgeRegistered = false

        private fun ensureBridgeRegistered(context: Context) {
            if (bridgeRegistered) return
            bridgeRegistered = true
            NotificationDecryptionBridge.onDecrypted = { roomId, eventId, senderId, senderName, body, roomName ->
                NotificationRenderer.show(
                    context.applicationContext, roomId, eventId, senderId, senderName, body, roomName ?: "FoxChat",
                    channelId = MESSAGE_NOTIFICATION_CHANNEL_ID, silent = false, timestamp = System.currentTimeMillis(),
                )
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        ensureBridgeRegistered(applicationContext)
        val data = message.data
        val roomId = data[ROOM_ID_EXTRA] ?: return
        val matrixEventId = data["event_id"]?.let { if (it.startsWith("\$")) it else "\$$it" }
        val eventId = matrixEventId ?: "${roomId}:${System.currentTimeMillis()}"
        val silent = data["silent"] == "true"
        val channelId =
            if (silent) SILENT_NOTIFICATION_CHANNEL_ID else MESSAGE_NOTIFICATION_CHANNEL_ID
        val roomName = data["room_name"] ?: data["title"] ?: "FoxChat"
        val realBody = data["body"]
        val senderId = data["sender"] ?: ""
        val senderName = data["sender_name"] ?: senderId.ifEmpty { "Someone" }
        val body = realBody ?: "Sent an encrypted message"
        val timestamp = data["timestamp"]?.toLongOrNull() ?: System.currentTimeMillis()

        if (matrixEventId != null) {
            val decryptIntent = Intent(applicationContext, NotificationDecryptService::class.java).apply {
                putExtra(NOTIFICATION_DECRYPT_ROOM_ID_EXTRA, roomId)
                putExtra(NOTIFICATION_DECRYPT_EVENT_ID_EXTRA, matrixEventId)
                putExtra(NOTIFICATION_FALLBACK_SENDER_ID_EXTRA, senderId)
                putExtra(NOTIFICATION_FALLBACK_SENDER_NAME_EXTRA, senderName)
                putExtra(NOTIFICATION_FALLBACK_BODY_EXTRA, body)
                putExtra(NOTIFICATION_FALLBACK_ROOM_NAME_EXTRA, roomName)
                putExtra(NOTIFICATION_FALLBACK_SILENT_EXTRA, silent)
                putExtra(NOTIFICATION_FALLBACK_TIMESTAMP_EXTRA, timestamp)
            }
            ContextCompat.startForegroundService(applicationContext, decryptIntent)
        } else {
            NotificationRenderer.show(
                applicationContext, roomId, eventId, senderId, senderName, body, roomName,
                channelId, silent, timestamp,
            )
        }
    }
}

object NotificationRenderer {
    fun show(
        context: Context,
        roomId: String,
        eventId: String,
        senderId: String,
        senderName: String,
        body: String,
        roomName: String,
        channelId: String,
        silent: Boolean,
        timestamp: Long,
    ) {
        if (NativeNotificationCrypto.isOwnUser(context, senderId)) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureChannels(context)
        val cachedRoomName = NativeNotificationCrypto.roomName(context, roomId)
        val displayRoomName = roomName.takeUnless { it == "FoxChat" || it.isBlank() } ?: cachedRoomName
        val roomAvatar = NativeNotificationCrypto.roomAvatarFile(context, roomId)
            ?.let { BitmapFactory.decodeFile(it.absolutePath) }

        val messages = RoomNotificationStore.append(context, roomId, eventId, senderId, senderName, body, timestamp)
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(ROOM_ID_EXTRA, roomId)
        }
        val openPendingIntent = PendingIntent.getActivity(
            context,
            roomId.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val readIntent = Intent(context, FoxChatNotificationActionService::class.java).apply {
            action = MARK_READ_ACTION
            putExtra(ROOM_ID_EXTRA, roomId)
        }
        val readPendingIntent = PendingIntent.getService(
            context,
            roomId.hashCode(),
            readIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val dismissIntent = Intent(context, FoxChatNotificationActionService::class.java).apply {
            action = DISMISS_ACTION
            putExtra(ROOM_ID_EXTRA, roomId)
        }
        val dismissPendingIntent = PendingIntent.getService(
            context,
            roomId.hashCode() xor 0x4449534d,
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val readAction = NotificationCompat.Action.Builder(
            R.mipmap.ic_launcher,
            "Mark as read",
            readPendingIntent,
        )
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()
        val replyIntent = Intent(context, FoxChatNotificationActionService::class.java).apply {
            action = REPLY_ACTION
            putExtra(ROOM_ID_EXTRA, roomId)
        }
        // RemoteInput needs a mutable PendingIntent.
        val replyPendingIntent = PendingIntent.getService(
            context,
            roomId.hashCode() xor 0x5245504c,
            replyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        val replyAction = NotificationCompat.Action.Builder(
            R.mipmap.ic_launcher,
            "Reply",
            replyPendingIntent,
        )
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .setAllowGeneratedReplies(true)
            .addRemoteInput(RemoteInput.Builder(REPLY_INPUT_KEY).setLabel("Reply").build())
            .build()

        val user = Person.Builder().setName("You").setKey("foxchat-user").build()
        val style = NotificationCompat.MessagingStyle(user)
            .setConversationTitle(displayRoomName)
            .setGroupConversation(true)
        for (stored in messages) {
            val senderBuilder = Person.Builder()
                .setName(stored.getString("sender_name"))
                .setKey(stored.getString("sender_id"))
            if (roomAvatar != null) {
                senderBuilder.setIcon(IconCompat.createWithBitmap(roomAvatar))
            }
            val sender = senderBuilder.build()
            style.addMessage(stored.getString("body"), stored.getLong("timestamp"), sender)
        }

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(displayRoomName)
            .setContentText(body)
            .setStyle(style)
            .setContentIntent(openPendingIntent)
            .setDeleteIntent(dismissPendingIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setGroup("foxchat.room.$roomId")
            .setOnlyAlertOnce(true)
            .setSilent(silent)
            .addAction(replyAction)
            .addAction(readAction)
            .addInvisibleAction(readAction)
        if (!silent) notification.setSound(notificationSound(context))
        if (roomAvatar != null) notification.setLargeIcon(roomAvatar)

        // Stable IDs keep one Android conversation per room.
        manager.notify(roomId, roomId.hashCode(), notification.build())
    }

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val soundAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        manager.createNotificationChannel(
            NotificationChannel(
                MESSAGE_NOTIFICATION_CHANNEL_ID,
                "New messages",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "New FoxChat messages"
                setSound(notificationSound(context), soundAttributes)
            },
        )
        manager.createNotificationChannel(NotificationChannel(SILENT_NOTIFICATION_CHANNEL_ID, "Additional unread messages", NotificationManager.IMPORTANCE_LOW).apply {
            setSound(null, null)
            enableVibration(false)
        })
    }

    private fun notificationSound(context: Context): Uri =
        Uri.parse(
            "${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/${R.raw.notification}",
        )
}
