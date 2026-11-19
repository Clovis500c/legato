package app.legato.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONObject

// One row of the queue the page sends for the widget: its index in the page's list, title, artist and the song's id (`key`: its thumbnail's).
class QueueRow(val index: Int, val title: String, val artist: String, val key: Long)

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
  // A bigger cover (600 px) for the disc widget, which draws at the widget's real size.
  @Volatile var big: Bitmap? = null
  @Volatile var queue: List<QueueRow> = emptyList()
  // PlaybackService is up (the widgets' buttons have someone to answer them). Set by the service, never the page's state.
  @Volatile var running = false
  @Volatile var onChange: (() -> Unit)? = null
  @Volatile private var page: JavaScriptReplyProxy? = null
  // Small covers of the queue widget's first rows by song id, the 40 last used kept (a queue change does not ask them again).
  private val thumbs = object : LinkedHashMap<Long, Bitmap>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, Bitmap>): Boolean = size > 40
  }

  fun thumb(key: Long): Bitmap? = synchronized(thumbs) { thumbs[key] }

  // A message from the page: {} clears (nothing playing); {"cover": base64} follows each new song ("" = none).
  fun fromPage(json: String, reply: JavaScriptReplyProxy) {
    page = reply
    try {
      val o = JSONObject(json)
      if (o.has("queue")) {
        val rows = o.getJSONArray("queue")
        val next = ArrayList<QueueRow>()
        for (k in 0 until minOf(rows.length(), 30)) {
          val r = rows.getJSONObject(k)
          next.add(QueueRow(r.getInt("i"), r.getString("t"), r.optString("a", ""), r.optLong("k", -1L)))
        }
        queue = next
      } else if (o.has("cover")) {
        val data = Base64.decode(o.getString("cover"), Base64.DEFAULT)
        cover = if (data.isEmpty()) null else BitmapFactory.decodeByteArray(data, 0, data.size)
      } else if (o.has("big")) {
        val data = Base64.decode(o.getString("big"), Base64.DEFAULT)
        big = if (data.isEmpty()) null else BitmapFactory.decodeByteArray(data, 0, data.size)
      } else if (o.has("thumb")) {
        val t = o.getJSONObject("thumb")
        val data = Base64.decode(t.getString("d"), Base64.DEFAULT)
        val bitmap = if (data.isEmpty()) null else BitmapFactory.decodeByteArray(data, 0, data.size)
        if (bitmap != null) synchronized(thumbs) { thumbs[t.getLong("k")] = bitmap }
      } else {
        val next = if (o.has("title")) o.getString("title") else null
        // Another song: the last one's cover goes until its own comes.
        if (next != title) {
          cover = null
          big = null
        }
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
