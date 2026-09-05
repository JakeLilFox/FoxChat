package foxchat.jakefox.de

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import app.tauri.remotepush.NativeCryptoBridge
import app.tauri.remotepush.NotificationDecryptionBridge
import app.tauri.remotepush.NotificationDebugBridge

class MainActivity : TauriActivity() {
  override val handleBackNavigation: Boolean = false
  private var webView: WebView? = null
  private var pendingShareIntent: Intent? = null
  private var pendingNotificationRoomId: String? = null
  private val shareExecutor = Executors.newSingleThreadExecutor()
  private val windowAppearanceBridge = WindowAppearanceBridge()
  private val notificationReplyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) { dispatchPendingNotificationReplies() }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    val appContext = applicationContext
    NativeCryptoBridge.webViewActive = true
    NativeMatrixClientManager.bootstrap(appContext)
    getSharedPreferences("foxchat_boot_diagnostics", Context.MODE_PRIVATE).edit()
      .putString("stage", "MainActivity.onCreate entered")
      .putLong("at", System.currentTimeMillis()).commit()
    NativeCryptoBridge.sync = { userId, deviceId, homeserver, accessToken, refreshToken, roomKeys, rooms, backupVersion, backupRecoveryKey, pushClearToken, pushGatewayUrl ->
      NativeNotificationCrypto.stageSync(
        applicationContext, userId, deviceId, homeserver, accessToken, refreshToken, roomKeys, rooms,
        backupVersion, backupRecoveryKey, pushClearToken, pushGatewayUrl,
      )
    }
    NativeCryptoBridge.status = {
      NativeNotificationCrypto.status(applicationContext)
        .put("matrixClient", NativeMatrixClientManager.status(applicationContext))
        .put("clientErrors", NativeClientLogStore.entries(applicationContext))
        .toString()
    }
    NativeCryptoBridge.sessionTokens = { userId ->
      (NativeMatrixClientManager.sessionTokens(applicationContext, userId)
        ?: NativeNotificationCrypto.nativeSessionTokens(applicationContext, userId)).toString()
    }
    NativeCryptoBridge.recordError = { source, error ->
      NativeClientLogStore.recordNative(appContext, source, error)
    }
    NativeCryptoBridge.matrix = { action, rawPayload ->
      val payload = JSONObject(rawPayload)
      when (action) {
        "logClientError" -> {
          NativeClientLogStore.record(applicationContext, rawPayload)
          JSONObject().put("ok", true).toString()
        }
        "status" -> NativeMatrixClientManager.status(applicationContext).toString()
        "login" -> NativeMatrixClientManager.loginNewAccount(
          applicationContext,
          payload.getString("homeserver"),
          payload.getString("username"),
          payload.getString("password"),
        ).toString()
        "adoptExistingDevice" -> NativeMatrixClientManager.adoptExistingDevice(
          applicationContext,
          payload.getString("userId"),
          payload.getString("deviceId"),
          payload.getString("homeserver"),
          payload.getString("accessToken"),
          payload.optString("refreshToken").takeIf { it.isNotBlank() },
          payload.optString("secretsBundle").takeIf { it.isNotBlank() },
          payload.optString("backupInfo").takeIf { it.isNotBlank() },
          payload.optString("validationRoomId").takeIf { it.isNotBlank() },
          payload.optString("validationEventId").takeIf { it.isNotBlank() },
        ).toString()
        "adoptFreshSession" -> NativeMatrixClientManager.adoptFreshSession(
          applicationContext,
          payload.getString("userId"),
          payload.getString("deviceId"),
          payload.getString("homeserver"),
          payload.getString("accessToken"),
          payload.optString("refreshToken").takeIf { it.isNotBlank() },
        ).toString()
        "decryptEvent" -> {
          val event = NativeMatrixClientManager.decryptEvent(
            applicationContext,
            payload.getString("roomId"),
            payload.getString("eventId"),
          )
          JSONObject()
            .put("ok", true)
            .put("userId", event.userId)
            .put("roomId", event.roomId)
            .put("eventId", event.eventId)
            .put("senderId", event.senderId)
            .put("senderName", event.senderName)
            .put("roomName", event.roomName)
            .put("body", event.body())
            .put("rawEvent", event.rawEvent)
            .toString()
        }
        "sendRaw" -> {
          NativeMatrixClientManager.sendRaw(
            applicationContext,
            payload.getString("userId"),
            payload.getString("roomId"),
            payload.getString("eventType"),
            payload.getJSONObject("content").toString(),
          )
          JSONObject().put("ok", true).toString()
        }
        "watchRoom" -> NativeMatrixClientManager.watchRoom(
          applicationContext,
          payload.getString("userId"),
          payload.getString("roomId"),
        ).toString()
        "sendStateRaw" -> JSONObject()
          .put("ok", true)
          .put(
            "eventId",
            NativeMatrixClientManager.sendStateRaw(
              applicationContext,
              payload.getString("userId"),
              payload.getString("roomId"),
              payload.getString("eventType"),
              payload.optString("stateKey"),
              payload.getJSONObject("content").toString(),
            ),
          )
          .toString()
        "redact" -> {
          NativeMatrixClientManager.redact(
            applicationContext,
            payload.getString("userId"),
            payload.getString("roomId"),
            payload.getString("eventId"),
            payload.optString("reason").takeIf { it.isNotBlank() },
          )
          JSONObject().put("ok", true).toString()
        }
        "setTyping" -> {
          NativeMatrixClientManager.setTyping(
            applicationContext,
            payload.getString("userId"),
            payload.getString("roomId"),
            payload.optBoolean("typing"),
          )
          JSONObject().put("ok", true).toString()
        }
        "setPresence" -> {
          NativeMatrixClientManager.setPresence(
            applicationContext,
            payload.getString("userId"),
            payload.getString("presence"),
          )
          JSONObject().put("ok", true).toString()
        }
        "markRead" -> {
          NativeMatrixClientManager.markReadForRoom(
            applicationContext,
            payload.getString("roomId"),
          )
          JSONObject().put("ok", true).toString()
        }
        "logout" -> {
          NativeMatrixClientManager.logout(
            applicationContext,
            payload.getString("userId"),
          )
          JSONObject().put("ok", true).toString()
        }
        "recover" -> {
          NativeMatrixClientManager.recover(
            applicationContext,
            payload.getString("userId"),
            payload.getString("recoveryKey"),
          )
          JSONObject().put("ok", true).put("background", true).toString()
        }
        "setupRecovery" -> NativeMatrixClientManager.setupRecovery(
          applicationContext,
          payload.getString("userId"),
          payload.optString("passphrase").takeIf { it.isNotBlank() },
        ).toString()
        "securityStatus" -> NativeMatrixClientManager.securityStatus(
          applicationContext,
          payload.getString("userId"),
        ).toString()
        "userIdentities" -> NativeMatrixClientManager.userIdentities(
          applicationContext,
          payload.getString("userId"),
          payload.getJSONArray("targetUserIds"),
        ).toString()
        "verificationStatus" -> NativeMatrixClientManager.verificationStatus(
          applicationContext,
          payload.getString("userId"),
        ).toString()
        "verificationRequest" -> NativeMatrixClientManager.requestVerification(
          applicationContext,
          payload.getString("userId"),
          payload.optString("targetUserId").takeIf { it.isNotBlank() },
        ).toString()
        "verificationAccept" -> NativeMatrixClientManager.acceptVerification(
          applicationContext,
          payload.getString("userId"),
          payload.getString("requestId"),
        ).toString()
        "verificationStartSas" -> NativeMatrixClientManager.startSasVerification(
          applicationContext,
          payload.getString("userId"),
          payload.getString("requestId"),
        ).toString()
        "verificationApprove" -> NativeMatrixClientManager.approveVerification(
          applicationContext,
          payload.getString("userId"),
          payload.getString("requestId"),
        ).toString()
        "verificationDecline" -> NativeMatrixClientManager.declineVerification(
          applicationContext,
          payload.getString("userId"),
          payload.getString("requestId"),
        ).toString()
        "verificationCancel" -> NativeMatrixClientManager.cancelVerification(
          applicationContext,
          payload.getString("userId"),
          payload.getString("requestId"),
        ).toString()
        else -> error("Unknown native Matrix action: $action")
      }
    }
    NotificationDecryptionBridge.onCompleted = { roomId, eventId ->
      NativeNotificationRetryManager.complete(applicationContext, roomId, eventId)
    }
    NativeCryptoBridge.test = { roomId, eventId ->
      val result = NativeNotificationCrypto.decrypt(applicationContext, roomId, eventId)
      NativeNotificationCrypto.setEnabled(applicationContext, true)
      JSONObject()
        .put("ok", true)
        .put("roomId", roomId)
        .put("eventId", eventId)
        .put("senderId", result.senderId)
        .put("body", result.body)
        .toString()
    }
    NotificationDebugBridge.showAndroidAutoTest = { roomId, roomName, senderName, body ->
      val eventId = "\$android-auto-test-${System.currentTimeMillis()}"
      NativeNotificationCrypto.recordNotificationDiagnostic(
        applicationContext, "android-auto-test-posted", roomId, eventId,
      )
      NotificationRenderer.show(
        applicationContext,
        roomId,
        eventId,
        "@foxchat:test",
        senderName,
        body,
        roomName,
        MESSAGE_NOTIFICATION_CHANNEL_ID,
        false,
        System.currentTimeMillis(),
      )
    }
    NotificationRenderer.ensureChannels(applicationContext)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    acceptNotificationIntent(intent)
    getSharedPreferences("foxchat_boot_diagnostics", Context.MODE_PRIVATE).edit()
      .putString("stage", "MainActivity.onCreate completed").apply()
    // Request camera and microphone access only when WebRTC needs them.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(notificationReplyReceiver, IntentFilter("foxchat.action.NATIVE_REPLY_READY"), RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(notificationReplyReceiver, IntentFilter("foxchat.action.NATIVE_REPLY_READY"))
    }
    acceptShareIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    // The Android E2E suite drives the exact release APK produced by CI. A
    // release WebView normally has no DevTools socket, so expose one only
    // when ADB is enabled and Appium supplies the dedicated launch flag.
    // Enabling Developer options alone never changes release behavior.
    val e2eDebugRequested =
      intent?.getBooleanExtra("foxchat.e2e.webview_debug", false) == true
    if (
      e2eDebugRequested &&
      Settings.Global.getInt(contentResolver, Settings.Global.ADB_ENABLED, 0) == 1
    ) {
      WebView.setWebContentsDebuggingEnabled(true)
    }
    this.webView = webView
    // setContentView(WebView) can expose a physical-pixel-wide strip of the
    // Activity surface on some edge-to-edge Android/WebView combinations. Keep
    // every native surface behind the page painted with the same app color so
    // that strip can never appear as the Material theme's default white.
    applyAppBackground(defaultAppBackground())
    webView.addJavascriptInterface(windowAppearanceBridge, "FoxChatWindowAppearance")
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(
          "Boolean(window.__foxchatHandleAndroidBack && window.__foxchatHandleAndroidBack())",
        ) { consumed ->
          if (consumed != "true") finishAndRemoveTask()
        }
      }
    })
    dispatchPendingNotificationReplies()
    pendingNotificationRoomId?.let {
      pendingNotificationRoomId = null
      openNotificationRoom(it)
    }
    pendingShareIntent?.let {
      pendingShareIntent = null
      acceptShareIntent(it)
    }
    handleWindowInsets(webView)
    getSharedPreferences("foxchat_boot_diagnostics", Context.MODE_PRIVATE).edit()
      .putString("stage", "WebView created").apply()
  }

  private fun defaultAppBackground(): Int {
    val nightMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    return if (nightMode == Configuration.UI_MODE_NIGHT_YES) DARK_APP_BACKGROUND else LIGHT_APP_BACKGROUND
  }

  private fun applyAppBackground(color: Int) {
    runOnUiThread {
      window.setBackgroundDrawable(ColorDrawable(color))
      window.decorView.setBackgroundColor(color)
      window.decorView.findViewById<View>(android.R.id.content)?.setBackgroundColor(color)
      webView?.setBackgroundColor(color)
    }
  }

  private inner class WindowAppearanceBridge {
    @JavascriptInterface
    fun setTheme(mode: String) {
      applyAppBackground(if (mode == "dark") DARK_APP_BACKGROUND else LIGHT_APP_BACKGROUND)
    }
  }

  // Chromium owns keyboard resizing. Native insets only expose navigation mode
  // and reserve edge gestures while the keyboard is closed.
  private fun handleWindowInsets(webView: WebView) {
    val contentRoot = window.decorView.findViewById<View>(android.R.id.content)
    val density = resources.displayMetrics.density
    val edgeWidth = (40 * density).toInt()
    var imeVisible = false
    var appliedTopInset = -1
    var appliedBottomInset = -1
    val applyGestureExclusion = {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val width = webView.width
        val height = webView.height
        if (width > 0 && height > 0) {
          webView.systemGestureExclusionRects = if (imeVisible) {
            emptyList()
          } else {
            val half = width / 2
            listOf(
              Rect(0, 0, edgeWidth.coerceAtMost(half), height),
              Rect((width - edgeWidth).coerceAtLeast(half), 0, width, height),
            )
          }
        }
      }
    }
    webView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> applyGestureExclusion() }
    webView.post { applyGestureExclusion() }

    val applyInsets = { insets: WindowInsetsCompat ->
      val statusBarTop = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
      val navigationBarBottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      val topInset = Math.round(statusBarTop / density)
      val bottomInset = Math.round(navigationBarBottom / density)
      // Avoid bridge work on every keyboard animation frame.
      if (topInset != appliedTopInset || bottomInset != appliedBottomInset) {
        appliedTopInset = topInset
        appliedBottomInset = bottomInset
        webView.evaluateJavascript(
          "document.documentElement.style.setProperty('--foxchat-top-inset','${topInset}px');" +
            "document.documentElement.style.setProperty('--foxchat-bottom-inset','${bottomInset}px')",
          null,
        )
      }
    }

    ViewCompat.setOnApplyWindowInsetsListener(contentRoot) { _, insets ->
      val nowVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
      if (nowVisible != imeVisible) {
        imeVisible = nowVisible
        applyGestureExclusion()
      }
      applyInsets(insets)
      insets
    }
    ViewCompat.requestApplyInsets(contentRoot)
  }

  companion object {
    private val LIGHT_APP_BACKGROUND = Color.rgb(245, 246, 250)
    private val DARK_APP_BACKGROUND = Color.rgb(17, 19, 26)
  }

  private fun dispatchPendingNotificationReplies() {
    val target = webView ?: return
    val preferences = getSharedPreferences("foxchat_pending_notification_replies", Context.MODE_PRIVATE)
    val raw = preferences.getString("replies", "[]") ?: "[]"
    val replies = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    if (replies.length() == 0) return
    // Remove replies before dispatch so they cannot replay after restart.
    preferences.edit().remove("replies").apply()
    val payload = replies.toString()
    runOnUiThread {
      target.evaluateJavascript("window.__foxchatPendingNotificationReplies=$payload;window.dispatchEvent(new CustomEvent('foxchat-native-notification-replies',{detail:window.__foxchatPendingNotificationReplies}));", null)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    acceptNotificationIntent(intent)
    acceptShareIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    NativeCryptoBridge.webViewActive = true
    NativeMatrixClientManager.ensureRunning(applicationContext, "activity-resume")
  }

  private fun acceptNotificationIntent(intent: Intent?) {
    val roomId = intent?.getStringExtra("room_id")?.takeIf { it.isNotBlank() } ?: return
    intent.removeExtra("room_id")
    if (webView == null) pendingNotificationRoomId = roomId else openNotificationRoom(roomId)
  }

  private fun openNotificationRoom(roomId: String) {
    val payload = JSONObject.quote(roomId)
    runOnUiThread {
      webView?.evaluateJavascript(
        "window.__foxchatPendingNotificationRoom=$payload;window.dispatchEvent(new CustomEvent('foxchat-open-room',{detail:$payload}));",
        null,
      )
    }
  }

  private fun acceptShareIntent(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND && intent?.action != Intent.ACTION_SEND_MULTIPLE) return
    if (webView == null) {
      pendingShareIntent = intent
      return
    }
    val uris = sharedUris(intent)
    if (uris.isEmpty()) return
    shareExecutor.execute {
      val files = JSONArray()
      for (uri in uris) {
        try {
          val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: continue
          val item = JSONObject()
            .put("name", displayName(uri))
            .put("type", contentResolver.getType(uri) ?: intent.type ?: "application/octet-stream")
            .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
          files.put(item)
        } catch (_: Exception) { }
      }
      if (files.length() == 0) return@execute
      val payload = JSONObject().put("files", files).toString()
      runOnUiThread {
        webView?.evaluateJavascript("window.__foxchatPendingShare=$payload;window.dispatchEvent(new CustomEvent('foxchat-native-share',{detail:window.__foxchatPendingShare}));", null)
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun sharedUris(intent: Intent): List<Uri> {
    val result = mutableListOf<Uri>()
    intent.clipData?.let { clip -> for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(result::add) }
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let(result::addAll)
    else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let(result::add)
    return result.distinct()
  }

  private fun displayName(uri: Uri): String {
    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) return cursor.getString(0) ?: "shared-file"
    }
    return uri.lastPathSegment ?: "shared-file"
  }

  override fun onDestroy() {
    NativeCryptoBridge.webViewActive = false
    unregisterReceiver(notificationReplyReceiver)
    shareExecutor.shutdownNow()
    super.onDestroy()
  }
}
