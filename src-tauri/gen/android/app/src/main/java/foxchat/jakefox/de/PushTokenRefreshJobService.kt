package foxchat.jakefox.de

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

private const val PUSH_TOKEN_JOB_ID = 0x4650434d

/** Persists FCM token rotation work so it runs without the Activity or WebView. */
object NativePushTokenManager {
    fun schedule(context: Context, token: String) {
        if (token.isBlank()) return
        NativeNotificationCrypto.storePendingPushToken(context, token)
        val job = JobInfo.Builder(
            PUSH_TOKEN_JOB_ID,
            ComponentName(context, PushTokenRefreshJobService::class.java),
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setBackoffCriteria(10_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .setPersisted(true)
            .build()
        (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler).schedule(job)
    }
}

class PushTokenRefreshJobService : JobService() {
    @Volatile private var stopped = false

    override fun onStartJob(params: JobParameters): Boolean {
        stopped = false
        Thread {
            var token: String? = null
            val succeeded = try {
                token = NativeNotificationCrypto.pendingPushToken(applicationContext)
                token.isNullOrBlank() ||
                    NativeNotificationCrypto.refreshPushersForToken(applicationContext, token!!)
            } catch (_: Throwable) {
                false
            }
            if (succeeded && !token.isNullOrBlank()) {
                NativeNotificationCrypto.clearPendingPushToken(applicationContext, token)
            }
            if (!stopped) jobFinished(params, !succeeded)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        stopped = true
        return true
    }
}
