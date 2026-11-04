package app.legato.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONObject

// What the page says is playing (title, artist, play state, position, cover) and the way back to it: the notification's
// and the lock screen's buttons answer the page, which owns the queue. Read by PlaybackService.
object MediaState {
  @Volatile var title: String? = null
  @Volatile var artist: String? = null
  @Volatile var playing = false
  @Volatile var positionMs = 0L
  @Volatile var durationMs = -1L
  @Volatile var stamp = 0L
  @Volatile var cover: Bitmap? = null
  @Volatile var onChange: (() -> Unit)? = null
  @Volatile private var page: JavaScriptReplyProxy? = null

  // A message from the page: {} clears (nothing playing); {"cover": base64} follows each new song ("" = none).
  fun fromPage(json: String, reply: JavaScriptReplyProxy) {
    page = reply
    try {
      val o = JSONObject(json)
      if (o.has("cover")) {
        val data = Base64.decode(o.getString("cover"), Base64.DEFAULT)
        cover = if (data.isEmpty()) null else BitmapFactory.decodeByteArray(data, 0, data.size)
      } else {
        val next = if (o.has("title")) o.getString("title") else null
        // Another song: the last one's cover goes until its own comes.
        if (next != title) cover = null
        title = next
        artist = if (o.has("artist")) o.getString("artist") else null
        playing = o.optBoolean("playing", false)
        positionMs = o.optLong("positionMs", 0)
        durationMs = o.optLong("durationMs", -1)
        stamp = System.currentTimeMillis()
      }
    } catch (e: Exception) {
      return
    }
    onChange?.invoke()
  }

  // A button: play, pause, next, previous, or seek:<ms>.
  fun toPage(action: String) {
    try {
      page?.postMessage(action)
    } catch (e: Exception) {
    }
  }
}
