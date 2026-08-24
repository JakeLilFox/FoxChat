package foxchat.jakefox.de

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.atomic.AtomicInteger

/**
 * Runs Rust/JNA setup without requiring the Activity or WebView. This service deliberately
 * stays in the app process: Android SharedPreferences, including EncryptedSharedPreferences,
 * do not support cross-process access, and all native crypto state must have one owner.
 */
class NativeCryptoSetupService : Service() {
    companion object {
        private const val CHANNEL_ID = "native_crypto_setup"
        private const val NOTIFICATION_ID = 918_274
    }
    private val activeJobs = AtomicInteger()
    private val activeUserIds = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, setupNotification())
        val userId = intent?.getStringExtra("user_id")
        if (userId.isNullOrEmpty()) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }
        activeJobs.incrementAndGet()
        activeUserIds.add(userId)
        Thread {
            try {
                NativeNotificationCrypto.completeStagedSync(applicationContext, userId)
            } catch (_: Throwable) {
                // Normal failures are persisted by completeStagedSync. Native aborts kill
                // only this helper process; a stale pending state is reported by the UI.
            } finally {
                activeUserIds.remove(userId)
                if (activeJobs.decrementAndGet() == 0) stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf(startId)
            }
        }.start()
        return START_NOT_STICKY
    }


    override fun onTimeout(startId: Int, fgsType: Int) {
        for (userId in activeUserIds) NativeNotificationCrypto.markSetupTimedOut(applicationContext, userId)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    private fun setupNotification(): android.app.Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Notification decryption setup", NotificationManager.IMPORTANCE_LOW)
                    .apply { setShowBadge(false) },
            )
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("FoxChat")
            .setContentText("Preparing encrypted notifications…")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }
}
