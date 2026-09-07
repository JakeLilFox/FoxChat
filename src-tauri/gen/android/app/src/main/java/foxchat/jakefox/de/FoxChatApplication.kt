package foxchat.jakefox.de

import android.app.Application
import android.util.Log
import com.google.firebase.FirebaseApp

/**
 * Initializes process-global native services even when Android starts FoxChat for a push or
 * JobService without creating the WebView activity.
 */
class FoxChatApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val firebase = runCatching {
            FirebaseApp.getApps(this).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
                ?: FirebaseApp.initializeApp(this)
        }.onFailure { error ->
            Log.e("FoxChatFirebase", "Default Firebase initialization failed", error)
        }.getOrNull()
        if (firebase == null) {
            Log.e(
                "FoxChatFirebase",
                "Default Firebase app is unavailable; verify that this build contains google_app_id and gcm_defaultSenderId resources",
            )
        }
        NativeMatrixClientManager.initializePlatform()
    }
}
