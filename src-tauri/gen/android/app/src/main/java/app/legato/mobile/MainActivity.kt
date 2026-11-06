package app.legato.mobile

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.lang.reflect.Field
import org.json.JSONArray

class MainActivity : TauriActivity() {
  // Your devices on the same Wi-Fi (mDNS): Android drops multicast packets unless an app holds this lock.
  private var multicast: WifiManager.MulticastLock? = null
  private var web: WebView? = null

  // wry's own field for its WebView (private), emptied once the WebView is made: wry then never pauses it as the app
  // leaves the screen. Paused, Chromium paused YouTube's video; resumed at once, it still cut the music a moment (the
  // owner's report, 2026-11-04). Null: a wry without that field, its pause undone at once (onPause).
  private val wryWebView: Field? = WryActivity::class.java.declaredFields.firstOrNull { it.type == RustWebView::class.java }?.apply { isAccessible = true }

  // wry's Back reads that field: the page's own (PageBack) while it's emptied.
  override val handleBackNavigation: Boolean
    get() = wryWebView == null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge to edge (forced from Android 15): the page keeps clear of the bars, the cutout and the keyboard.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicast = wifi.createMulticastLock("legato-devices").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  // wry puts its WebView on screen here, after onWebViewCreate: in a frame that keeps its window shown (KeepVisible).
  override fun setContentView(view: View?) = super.setContentView(if (view is WebView) KeepVisible(this).apply { addView(view) } else view)

  // YouTube's player stops when its page is hidden, as the app leaves the screen: in YouTube's frames only, the page
  // always says visible (the owner's choice, 2026-11-03, against YouTube's terms: background play is Premium's), the
  // WebView's window stays shown (setContentView) and wry never pauses the WebView (wryWebView), or Chromium pauses the
  // video itself.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    web = webView
    wryWebView?.let {
      it.set(this, null)
      onBackPressedDispatcher.addCallback(this, PageBack())
    }
    runOnUiThread {
      if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
        WebViewCompat.addDocumentStartJavaScript(webView, VISIBLE, YOUTUBE)
      }
      // The app's own page only (never YouTube's frames) tells what plays and takes the buttons back.
      if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
        WebViewCompat.addWebMessageListener(webView, "LegatoMedia", APP) { _, message, _, _, reply ->
          message.data?.let { MediaState.fromPage(it, reply) }
        }
        // Music Detector: Android's microphone permission, asked as it first listens; Legato's app info for a refusal.
        WebViewCompat.addWebMessageListener(webView, "LegatoMic", APP) { _, message, _, _, reply ->
          when (message.data) {
            "ask" ->
              if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) reply.postMessage("yes")
              else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO)) { granted -> reply.postMessage(if (granted == true) "yes" else "no") }
            "settings" -> startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
          }
        }
        // Music on this phone: Android's permission to read its songs (asked, or only checked at launch), then the
        // folders they're kept in; "no" when refused.
        WebViewCompat.addWebMessageListener(webView, "LegatoMusic", APP) { _, message, _, _, reply ->
          val read = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
          val answer = { granted: Boolean -> reply.postMessage(if (granted) musicFolders() else "no") }
          val has = checkSelfPermission(read) == PackageManager.PERMISSION_GRANTED
          when (message.data) {
            "check" -> answer(has)
            "ask" -> if (has) answer(true) else requestPermissions(arrayOf(read)) { granted -> answer(granted == true) }
          }
        }
      }
    }
  }

  // Where a phone keeps songs: its Music and Download folders, as a JSON list of paths (Rust drops a missing one).
  @Suppress("DEPRECATION")
  private fun musicFolders() =
    JSONArray(listOf(Environment.DIRECTORY_MUSIC, Environment.DIRECTORY_DOWNLOADS).map { Environment.getExternalStoragePublicDirectory(it).absolutePath }).toString()

  // On screen: the playback service may start (Android 12 refuses it from the background); it stops itself once off
  // screen and silent.
  override fun onResume() {
    super.onResume()
    onScreen = true
    try {
      startForegroundService(Intent(this, PlaybackService::class.java))
    } catch (e: Exception) {
    }
    // An update downloaded off screen, or back from Android's "Install unknown apps" page: its installer now.
    ApkInstall.resumed(this)
  }

  // wry pauses no WebView here (wryWebView): the music goes on behind other apps. A wry whose field wasn't found pauses
  // it, media with it: undone at once.
  override fun onPause() {
    super.onPause()
    onScreen = false
    if (wryWebView == null) web?.onResume()
  }

  // Back: the app's own first (`window.legatoBack`, ui/src/app/androidBack.ts: a menu, a dialog, a full screen, Now
  // Playing, then the page before), then the page's history, then onBackPressed (wry's own way, its field emptied).
  private inner class PageBack : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      val view = web ?: return behind()
      view.evaluateJavascript("(window.legatoBack ? window.legatoBack() : false)") { taken ->
        if (taken == "true") return@evaluateJavascript
        if (view.canGoBack()) view.goBack() else behind()
      }
    }

    @Suppress("DEPRECATION")
    private fun behind() {
      isEnabled = false
      onBackPressed()
      isEnabled = true
    }
  }

  // Back at the root would close the app and the music (from Android 12 on, unless it was opened from the home screen):
  // it goes behind the other apps instead, as Home does.
  @Suppress("DEPRECATION")
  override fun onBackPressed() {
    if (isTaskRoot) moveTaskToBack(true) else super.onBackPressed()
  }

  override fun onDestroy() {
    multicast?.release()
    // wry's destroy hook names its WebView by that field.
    web?.let { wryWebView?.set(this, it) }
    super.onDestroy()
  }

  companion object {
    // Read by PlaybackService.
    @Volatile var onScreen = false
    private val APP = setOf("http://tauri.localhost", "https://tauri.localhost")
    private val YOUTUBE = setOf("https://www.youtube.com", "https://www.youtube-nocookie.com", "https://m.youtube.com", "https://music.youtube.com")
    private const val VISIBLE = """(() => {
  const say = (k, v) => { try { Object.defineProperty(Document.prototype, k, { configurable: true, get: () => v }) } catch (e) {} }
  say('hidden', false); say('visibilityState', 'visible'); say('webkitHidden', false); say('webkitVisibilityState', 'visible')
  for (const t of ['visibilitychange', 'webkitvisibilitychange']) window.addEventListener(t, (e) => e.stopImmediatePropagation(), true)
})()"""
  }
}

// Home, another app or the screen off: Android tells the views their window is gone, and Chromium then pauses the page's
// videos, the music with them. Below this frame the window always stays shown; a real detach still reaches the WebView.
private class KeepVisible(context: Context) : FrameLayout(context) {
  override fun dispatchWindowVisibilityChanged(visibility: Int) = super.dispatchWindowVisibilityChanged(View.VISIBLE)
}
