package foxchat.jakefox.de

import android.app.Application

/**
 * Initializes process-global native services even when Android starts FoxChat for a push or
 * JobService without creating the WebView activity.
 */
class FoxChatApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NativeMatrixClientManager.initializePlatform()
    }
}
