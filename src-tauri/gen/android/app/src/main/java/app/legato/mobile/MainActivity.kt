package app.legato.mobile

import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  // Your devices on the same Wi-Fi (mDNS): Android drops multicast packets unless an app holds this lock.
  private var multicast: WifiManager.MulticastLock? = null
  private var web: WebView? = null

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

  // YouTube's player stops when its page is hidden, as the app leaves the screen: in YouTube's frames only, the page
  // always says visible (the owner's choice, 2026-11-03, against YouTube's terms: background play is Premium's).
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    web = webView
    runOnUiThread {
      if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
        WebViewCompat.addDocumentStartJavaScript(webView, VISIBLE, YOUTUBE)
      }
      // The app's own page only (never YouTube's frames) tells what plays and takes the buttons back.
      if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
        WebViewCompat.addWebMessageListener(webView, "LegatoMedia", APP) { _, message, _, _, reply ->
          message.data?.let { MediaState.fromPage(it, reply) }
        }
      }
    }
  }

  // On screen: the playback service may start (Android 12 refuses it from the background); it stops itself once off
  // screen and silent.
  override fun onResume() {
    super.onResume()
    onScreen = true
    try {
      startForegroundService(Intent(this, PlaybackService::class.java))
    } catch (e: Exception) {
    }
  }

  // wry pauses the WebView here, its media with it: undone, the music goes on behind other apps.
  override fun onPause() {
    super.onPause()
    onScreen = false
    web?.onResume()
  }

  // Android 8 to 11: Back at the root would close the app and the music; 12 and later already send it to the background.
  @Suppress("DEPRECATION")
  override fun onBackPressed() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) moveTaskToBack(true) else super.onBackPressed()
  }

  override fun onDestroy() {
    multicast?.release()
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
