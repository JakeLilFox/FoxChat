package foxchat.jakefox.de

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

private const val NOTIFICATION_DECRYPT_JOB_ID = 0x46434452
private const val PENDING_NOTIFICATION_PREFS = "foxchat_pending_notification_decrypt"
private const val PENDING_NOTIFICATION_KEY = "events"
private const val FIRST_RETRY_DELAY_MS = 30_000L
private const val MAX_PENDING_AGE_MS = 24 * 60 * 60_000L
private const val MAX_PENDING_EVENTS = 50

data class PendingNotificationDecrypt(
    val roomId: String,
    val eventId: String,
    val senderId: String,
    val senderName: String,
    val body: String,
    val roomName: String,
    val silent: Boolean,
    val timestamp: Long,
    val queuedAt: Long = System.currentTimeMillis(),
)

object NativeNotificationRetryManager {
    @Synchronized
    fun enqueue(context: Context, value: PendingNotificationDecrypt) {
        val pending = read(context)
            .filterNot { it.roomId == value.roomId && it.eventId == value.eventId }
            .plus(value)
            .takeLast(MAX_PENDING_EVENTS)
        write(context, pending)
        schedule(context)
    }

    @Synchronized
    fun complete(context: Context, roomId: String, eventId: String) {
        write(context, read(context).filterNot { it.roomId == roomId && it.eventId == eventId })
    }

    @Synchronized
    fun pending(context: Context): List<PendingNotificationDecrypt> {
        val cutoff = System.currentTimeMillis() - MAX_PENDING_AGE_MS
        val current = read(context)
        val live = current.filter { it.queuedAt >= cutoff }
        if (live.size != current.size) write(context, live)
        return live
    }

    fun schedule(context: Context) {
        val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        if (scheduler.getPendingJob(NOTIFICATION_DECRYPT_JOB_ID) != null) return
        val job = JobInfo.Builder(
            NOTIFICATION_DECRYPT_JOB_ID,
            ComponentName(context, NotificationDecryptRetryJobService::class.java),
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(FIRST_RETRY_DELAY_MS)
            .setBackoffCriteria(FIRST_RETRY_DELAY_MS, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .setPersisted(true)
            .build()
        scheduler.schedule(job)
    }

    private fun read(context: Context): List<PendingNotificationDecrypt> {
        val values = try {
            JSONArray(preferences(context).getString(PENDING_NOTIFICATION_KEY, "[]"))
        } catch (_: Exception) {
            JSONArray()
        }
        return buildList {
            for (index in 0 until values.length()) {
                val item = values.optJSONObject(index) ?: continue
                val roomId = item.optString("roomId")
                val eventId = item.optString("eventId")
                if (roomId.isBlank() || eventId.isBlank()) continue
                add(
                    PendingNotificationDecrypt(
                        roomId = roomId,
                        eventId = eventId,
                        senderId = item.optString("senderId"),
                        senderName = item.optString("senderName", "Someone"),
                        body = item.optString("body", "Sent an encrypted message"),
                        roomName = item.optString("roomName", "FoxChat"),
                        silent = item.optBoolean("silent", false),
                        timestamp = item.optLong("timestamp", System.currentTimeMillis()),
                        queuedAt = item.optLong("queuedAt", System.currentTimeMillis()),
                    ),
                )
            }
        }
    }

    private fun write(context: Context, values: List<PendingNotificationDecrypt>) {
        val array = JSONArray()
        for (value in values) {
            array.put(
                JSONObject()
                    .put("roomId", value.roomId)
                    .put("eventId", value.eventId)
                    .put("senderId", value.senderId)
                    .put("senderName", value.senderName)
                    .put("body", value.body)
                    .put("roomName", value.roomName)
                    .put("silent", value.silent)
                    .put("timestamp", value.timestamp)
                    .put("queuedAt", value.queuedAt),
            )
        }
        preferences(context).edit().putString(PENDING_NOTIFICATION_KEY, array.toString()).commit()
    }

    private fun preferences(context: Context) = EncryptedSharedPreferences.create(
        context,
        PENDING_NOTIFICATION_PREFS,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
}

class NotificationDecryptRetryJobService : JobService() {
    @Volatile private var stopped = false
    private var worker: Thread? = null

    override fun onStartJob(params: JobParameters): Boolean {
        stopped = false
        worker = Thread {
            var needsRetry = false
            for (pending in NativeNotificationRetryManager.pending(applicationContext)) {
                if (stopped) return@Thread
                try {
                    val decrypted = NativeNotificationCrypto.decrypt(
                        applicationContext,
                        pending.roomId,
                        pending.eventId,
                        pending.senderId,
                        pending.senderName,
                    )
                    if (stopped) return@Thread
                    if (!decrypted.suppressed) {
                        NotificationRenderer.show(
                            applicationContext,
                            pending.roomId,
                            pending.eventId,
                            decrypted.senderId,
                            decrypted.senderName,
                            decrypted.body,
                            NativeNotificationCrypto.roomName(applicationContext, pending.roomId),
                            if (pending.silent) SILENT_NOTIFICATION_CHANNEL_ID else MESSAGE_NOTIFICATION_CHANNEL_ID,
                            pending.silent,
                            decrypted.timestamp,
                        )
                    }
                    NativeNotificationCrypto.recordNotificationDiagnostic(
                        applicationContext,
                        if (decrypted.suppressed) "background-retry-suppressed" else "background-retry-succeeded",
                        pending.roomId,
                        pending.eventId,
                    )
                    NativeNotificationRetryManager.complete(
                        applicationContext,
                        pending.roomId,
                        pending.eventId,
                    )
                } catch (error: Throwable) {
                    needsRetry = true
                    NativeNotificationCrypto.recordNotificationDiagnostic(
                        applicationContext,
                        "background-retry-failed",
                        pending.roomId,
                        pending.eventId,
                        error,
                    )
                }
            }
            if (!stopped) {
                val stillPending = NativeNotificationRetryManager.pending(applicationContext).isNotEmpty()
                jobFinished(params, needsRetry || stillPending)
            }
        }.also { it.start() }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        stopped = true
        worker?.interrupt()
        worker = null
        return NativeNotificationRetryManager.pending(applicationContext).isNotEmpty()
    }
}
