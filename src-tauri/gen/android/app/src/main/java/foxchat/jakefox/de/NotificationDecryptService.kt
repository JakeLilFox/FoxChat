package foxchat.jakefox.de

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import app.tauri.remotepush.NativeCryptoBridge
import app.tauri.remotepush.NotificationDecryptionBridge
import app.tauri.remotepush.PushNotificationPlugin

private const val FOREGROUND_CHANNEL_ID = "background_decrypt"
private const val FOREGROUND_NOTIFICATION_ID = 918_273
private const val DECRYPT_TIMEOUT_MS = 25_000L
private const val WAKE_LOCK_TIMEOUT_MS = 30_000L
private val NATIVE_RETRY_DELAYS_MS = longArrayOf(2_000L, 6_000L)
const val NOTIFICATION_DECRYPT_ROOM_ID_EXTRA = "room_id"
const val NOTIFICATION_DECRYPT_EVENT_ID_EXTRA = "event_id"
const val NOTIFICATION_FALLBACK_SENDER_ID_EXTRA = "fallback_sender_id"
const val NOTIFICATION_FALLBACK_SENDER_NAME_EXTRA = "fallback_sender_name"
const val NOTIFICATION_FALLBACK_BODY_EXTRA = "fallback_body"
const val NOTIFICATION_FALLBACK_ROOM_NAME_EXTRA = "fallback_room_name"
const val NOTIFICATION_FALLBACK_SILENT_EXTRA = "fallback_silent"
const val NOTIFICATION_FALLBACK_TIMESTAMP_EXTRA = "fallback_timestamp"

/** Keeps notification decryption alive briefly while Android backgrounds the app. */
class NotificationDecryptService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private var roomId: String? = null
    private var eventId: String? = null
    private var fallback: FallbackNotification? = null
    private val timeout = Runnable {
        val currentRoomId = roomId
        val currentEventId = eventId
        if (currentRoomId != null && currentEventId != null) {
            NativeNotificationCrypto.recordNotificationDiagnostic(
                applicationContext, "timed-out", currentRoomId, currentEventId,
            )
            showFallback(currentRoomId, currentEventId)
        }
        finishAndStop()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestedRoomId = intent?.getStringExtra(NOTIFICATION_DECRYPT_ROOM_ID_EXTRA)
        val requestedEventId = intent?.getStringExtra(NOTIFICATION_DECRYPT_EVENT_ID_EXTRA)
        // Ignore concurrent work and stale service restarts.
        if (requestedRoomId.isNullOrEmpty() || requestedEventId.isNullOrEmpty() || roomId != null) {
            stopSelf()
            return START_NOT_STICKY
        }
        roomId = requestedRoomId
        eventId = requestedEventId
        fallback = FallbackNotification(
            intent.getStringExtra(NOTIFICATION_FALLBACK_SENDER_ID_EXTRA) ?: "",
            intent.getStringExtra(NOTIFICATION_FALLBACK_SENDER_NAME_EXTRA) ?: "Someone",
            intent.getStringExtra(NOTIFICATION_FALLBACK_BODY_EXTRA) ?: "New message",
            intent.getStringExtra(NOTIFICATION_FALLBACK_ROOM_NAME_EXTRA) ?: "FoxChat",
            intent.getBooleanExtra(NOTIFICATION_FALLBACK_SILENT_EXTRA, false),
            intent.getLongExtra(NOTIFICATION_FALLBACK_TIMESTAMP_EXTRA, System.currentTimeMillis()),
        )

        startForeground(FOREGROUND_NOTIFICATION_ID, placeholderNotification())

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "foxchat:notification-decrypt").apply {
            setReferenceCounted(false)
            acquire(WAKE_LOCK_TIMEOUT_MS)
        }

        handler.postDelayed(timeout, DECRYPT_TIMEOUT_MS)

        if (!NativeNotificationCrypto.isEnabled(applicationContext)) {
            NativeNotificationCrypto.recordNotificationDiagnostic(
                applicationContext, "native-disabled", requestedRoomId, requestedEventId,
            )
            requestWebViewFallback(requestedRoomId, requestedEventId)
            return START_NOT_STICKY
        }

        attemptNativeDecrypt(requestedRoomId, requestedEventId)

        return START_NOT_STICKY
    }

    private fun attemptNativeDecrypt(
        requestedRoomId: String,
        requestedEventId: String,
        retryIndex: Int? = null,
    ) {
        Thread {
            val decrypted = try {
                NativeNotificationCrypto.decrypt(
                    applicationContext,
                    requestedRoomId,
                    requestedEventId,
                    fallback?.senderId,
                    fallback?.senderName,
                )
            } catch (error: Throwable) {
                NativeNotificationCrypto.recordNotificationDiagnostic(
                    applicationContext,
                    if (retryIndex == null) "native-decrypt-failed" else "native-decrypt-retry-failed",
                    requestedRoomId,
                    requestedEventId,
                    error,
                )
                null
            }
            handler.post {
                if (!isCurrent(requestedRoomId, requestedEventId)) return@post
                if (decrypted != null) {
                    showNativeResult(requestedRoomId, requestedEventId, decrypted, retryIndex != null)
                    finishAndStop()
                } else if (retryIndex == null) {
                    requestWebViewFallback(requestedRoomId, requestedEventId)
                    if (isCurrent(requestedRoomId, requestedEventId)) {
                        scheduleNativeRetry(requestedRoomId, requestedEventId, 0)
                    }
                } else {
                    // Keep waiting for the WebView and try the native store once
                    // more if the service's short background window permits it.
                    scheduleNativeRetry(requestedRoomId, requestedEventId, retryIndex + 1)
                }
            }
        }.start()
    }

    private fun scheduleNativeRetry(requestedRoomId: String, requestedEventId: String, retryIndex: Int) {
        val delay = NATIVE_RETRY_DELAYS_MS.getOrNull(retryIndex) ?: return
        handler.postDelayed({
            if (!isCurrent(requestedRoomId, requestedEventId)) return@postDelayed
            // Tauri events are not queued while the WebView is unavailable. Re-emit
            // after it has had time to resume and process the Matrix event.
            PushNotificationPlugin.instance?.requestDecryption(requestedRoomId, requestedEventId)
            attemptNativeDecrypt(requestedRoomId, requestedEventId, retryIndex)
        }, delay)
    }

    private fun requestWebViewFallback(requestedRoomId: String, requestedEventId: String) {
        if (PushNotificationPlugin.instance == null || !NativeCryptoBridge.webViewActive) {
            NativeNotificationCrypto.recordNotificationDiagnostic(
                applicationContext, "webview-unavailable", requestedRoomId, requestedEventId,
            )
            showFallback(requestedRoomId, requestedEventId)
            finishAndStop()
            return
        }
        NativeNotificationCrypto.recordNotificationDiagnostic(
            applicationContext, "webview-fallback-requested", requestedRoomId, requestedEventId,
        )
        NotificationDecryptionBridge.awaitCompletion(requestedRoomId, requestedEventId) {
            NativeNotificationCrypto.recordNotificationDiagnostic(
                applicationContext, "webview-decrypted", requestedRoomId, requestedEventId,
            )
            handler.post { finishAndStop() }
        }
        PushNotificationPlugin.instance?.requestDecryption(requestedRoomId, requestedEventId)
    }

    private fun showNativeResult(
        requestedRoomId: String,
        requestedEventId: String,
        decrypted: NativeDecryptedNotification,
        retried: Boolean,
    ) {
        if (!decrypted.suppressed) {
            NotificationRenderer.show(
                applicationContext, requestedRoomId, requestedEventId, decrypted.senderId,
                decrypted.senderName, decrypted.body,
                NativeNotificationCrypto.roomName(applicationContext, requestedRoomId),
                channelId = if (fallback?.silent == true) {
                    SILENT_NOTIFICATION_CHANNEL_ID
                } else {
                    MESSAGE_NOTIFICATION_CHANNEL_ID
                },
                silent = fallback?.silent == true, timestamp = decrypted.timestamp,
            )
        }
        NativeNotificationCrypto.recordNotificationDiagnostic(
            applicationContext,
            when {
                decrypted.suppressed -> "suppressed-by-appearance"
                retried -> "native-decrypt-retry-succeeded"
                else -> "native-decrypted"
            },
            requestedRoomId,
            requestedEventId,
        )
    }

    private fun isCurrent(requestedRoomId: String, requestedEventId: String): Boolean =
        roomId == requestedRoomId && eventId == requestedEventId

    // Stop if Android's short service window expires.
    override fun onTimeout(startId: Int, fgsType: Int) {
        finishAndStop()
    }

    override fun onDestroy() {
        finishAndStop()
        super.onDestroy()
    }

    private fun finishAndStop() {
        handler.removeCallbacksAndMessages(null)
        val currentRoomId = roomId
        val currentEventId = eventId
        if (currentRoomId != null && currentEventId != null) NotificationDecryptionBridge.cancelAwait(currentRoomId, currentEventId)
        roomId = null
        eventId = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        fallback = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun showFallback(currentRoomId: String, currentEventId: String) {
        val value = fallback ?: return
        NotificationRenderer.show(
            applicationContext, currentRoomId, currentEventId, value.senderId, value.senderName,
            value.body, value.roomName,
            if (value.silent) SILENT_NOTIFICATION_CHANNEL_ID else MESSAGE_NOTIFICATION_CHANNEL_ID,
            value.silent, value.timestamp,
        )
    }

    private fun placeholderNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureForegroundChannel(manager)
        return NotificationCompat.Builder(this, FOREGROUND_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("FoxChat")
            .setContentText("Getting your message ready…")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .build()
    }

    private fun ensureForegroundChannel(manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (manager.getNotificationChannel(FOREGROUND_CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(FOREGROUND_CHANNEL_ID, "Background sync", NotificationManager.IMPORTANCE_MIN).apply {
                setShowBadge(false)
            },
        )
    }

    private data class FallbackNotification(
        val senderId: String,
        val senderName: String,
        val body: String,
        val roomName: String,
        val silent: Boolean,
        val timestamp: Long,
    )
}
