package app.legato.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

// Home-screen widgets. They only draw what `MediaState` already holds (what the page said is playing, its cover from the
// art cache): no network, no secret. Their buttons send the notification's actions to PlaybackService, which hands them to
// the page. Nothing is placed, nothing changes: a provider with no widget on the screen is never asked to draw.
object Widgets {
  /** Every widget redrawn from what plays now (PlaybackService calls it on each change). */
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    redraw(context, manager, RectangleWidget::class.java) { rectangle(context) }
    redraw(context, manager, DiscWidget::class.java) { disc(context) }
    try {
      val ids = manager.getAppWidgetIds(ComponentName(context, QueueWidget::class.java))
      if (ids.isNotEmpty()) {
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list)
      }
    } catch (e: Exception) {
      // Same as above: the next change tries again.
    }
  }

  private fun redraw(context: Context, manager: AppWidgetManager, provider: Class<*>, build: () -> RemoteViews) {
    try {
      val ids = manager.getAppWidgetIds(ComponentName(context, provider))
      if (ids.isNotEmpty()) manager.updateAppWidget(ids, build())
    } catch (e: Exception) {
      // A launcher that refuses a draw: the next change tries again.
    }
  }

  /** The widget for the song playing now; nothing playing: the app's name, and a tap opens the app. */
  fun rectangle(context: Context): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_rectangle)
    views.setOnClickPendingIntent(R.id.widget_root, open(context))
    val title = MediaState.title
    val buttons = intArrayOf(R.id.widget_previous, R.id.widget_play, R.id.widget_next)
    if (title == null) {
      views.setTextViewText(R.id.widget_title, context.getString(R.string.app_name))
      views.setTextViewText(R.id.widget_artist, context.getString(R.string.widget_idle))
      views.setImageViewResource(R.id.widget_cover, R.drawable.widget_cover_empty)
      for (id in buttons) views.setViewVisibility(id, View.GONE)
      return views
    }
    views.setTextViewText(R.id.widget_title, title)
    views.setTextViewText(R.id.widget_artist, MediaState.artist ?: "")
    val cover = MediaState.cover
    if (cover != null) views.setImageViewBitmap(R.id.widget_cover, small(cover, 192)) else views.setImageViewResource(R.id.widget_cover, R.drawable.widget_cover_empty)
    for (id in buttons) views.setViewVisibility(id, View.VISIBLE)
    views.setImageViewResource(R.id.widget_play, if (MediaState.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
    views.setOnClickPendingIntent(R.id.widget_previous, button(context, "previous", 11))
    views.setOnClickPendingIntent(R.id.widget_play, button(context, if (MediaState.playing) "pause" else "play", 12))
    views.setOnClickPendingIntent(R.id.widget_next, button(context, "next", 13))
    return views
  }

  /** The queue widget's frame: its rows come from QueueService; a tap on a row sends `play:<index>` (the current song's row: play or pause). */
  fun queueHead(context: Context, id: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_queue)
    val rows = Intent(context, QueueService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
    rows.data = Uri.parse(rows.toUri(Intent.URI_INTENT_SCHEME))
    views.setRemoteAdapter(R.id.widget_list, rows)
    views.setEmptyView(R.id.widget_list, R.id.widget_empty)
    // A template the rows fill in (their action): it has to be mutable, and it names PlaybackService, never anything else.
    val template = PendingIntent.getService(context, 30, Intent(context, PlaybackService::class.java), PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    views.setPendingIntentTemplate(R.id.widget_list, template)
    views.setOnClickPendingIntent(R.id.widget_empty, open(context))
    return views
  }

  /** The widget as a record: the cover as the label of a vinyl; play and next. Nothing playing: a bare record, a tap opens the app. */
  fun disc(context: Context): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_disc)
    views.setOnClickPendingIntent(R.id.widget_root, open(context))
    views.setImageViewBitmap(R.id.widget_cover, record(MediaState.cover, 360))
    val buttons = intArrayOf(R.id.widget_play, R.id.widget_next)
    if (MediaState.title == null) {
      for (id in buttons) views.setViewVisibility(id, View.GONE)
      return views
    }
    for (id in buttons) views.setViewVisibility(id, View.VISIBLE)
    views.setImageViewResource(R.id.widget_play, if (MediaState.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
    views.setOnClickPendingIntent(R.id.widget_play, button(context, if (MediaState.playing) "pause" else "play", 22))
    views.setOnClickPendingIntent(R.id.widget_next, button(context, "next", 23))
    return views
  }

  /** The square a cover is cut to (centered): left, top, side. */
  fun squareCrop(width: Int, height: Int): IntArray {
    val side = minOf(width, height)
    return intArrayOf((width - side) / 2, (height - side) / 2, side)
  }

  /** A black record `side` pixels wide with the cover round on its label (a plain grey label without one). */
  fun record(cover: Bitmap?, side: Int): Bitmap {
    val out = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val c = side / 2f
    paint.color = Color.parseColor("#111111")
    canvas.drawCircle(c, c, c, paint)
    paint.color = Color.parseColor("#2A2A2A")
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = side * 0.004f
    for (k in 1..3) canvas.drawCircle(c, c, c * (0.97f - k * 0.06f), paint)
    paint.style = Paint.Style.FILL
    val label = (side * 0.62f).toInt()
    if (cover != null) {
      val box = squareCrop(cover.width, cover.height)
      val square = Bitmap.createBitmap(cover, box[0], box[1], box[2], box[2])
      val scaled = Bitmap.createScaledBitmap(square, label, label, true)
      val shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
      shader.setLocalMatrix(Matrix().apply { setTranslate(c - label / 2f, c - label / 2f) })
      paint.shader = shader
      canvas.drawCircle(c, c, label / 2f, paint)
      paint.shader = null
    } else {
      paint.color = Color.parseColor("#3C4043")
      canvas.drawCircle(c, c, label / 2f, paint)
    }
    paint.color = Color.parseColor("#111111")
    canvas.drawCircle(c, c, side * 0.035f, paint)
    return out
  }

  /** The player's notification buttons, the same actions. */
  fun button(context: Context, action: String, code: Int): PendingIntent =
    PendingIntent.getService(context, code, Intent(context, PlaybackService::class.java).putExtra(PlaybackService.ACTION, action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  fun open(context: Context): PendingIntent = PendingIntent.getActivity(context, 10, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)

  /** A cover cut down so a widget's update stays well under Android's size limit for pictures. */
  fun small(bitmap: Bitmap, side: Int): Bitmap {
    val longest = maxOf(bitmap.width, bitmap.height)
    if (longest <= side) return bitmap
    val scale = side.toFloat() / longest
    return Bitmap.createScaledBitmap(bitmap, maxOf(1, (bitmap.width * scale).toInt()), maxOf(1, (bitmap.height * scale).toInt()), true)
  }
}

/** The queue widget: what plays and what follows, a tap plays that song. */
class QueueWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) appWidgetManager.updateAppWidget(id, Widgets.queueHead(context, id))
  }
}

/** The rows of the queue widget, from `MediaState.queue` (the page's, nothing loaded here). */
class QueueService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsService.RemoteViewsFactory = QueueRows(applicationContext)
}

class QueueRows(private val context: Context) : RemoteViewsService.RemoteViewsFactory {
  private var rows: List<QueueRow> = emptyList()

  override fun onCreate() {}

  override fun onDataSetChanged() {
    rows = MediaState.queue
  }

  override fun onDestroy() {}

  override fun getCount(): Int = rows.size

  override fun getViewAt(position: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_queue_row)
    val row = rows.getOrNull(position) ?: return views
    views.setTextViewText(R.id.widget_title, row.title)
    views.setTextViewText(R.id.widget_artist, row.artist)
    // The first row is the song playing: lit, and a tap on it plays or pauses.
    views.setTextColor(R.id.widget_title, if (position == 0) 0xFF8AB4F8.toInt() else 0xFFFFFFFF.toInt())
    val action = if (position == 0) (if (MediaState.playing) "pause" else "play") else "play:" + row.index
    views.setOnClickFillInIntent(R.id.widget_row, Intent().putExtra(PlaybackService.ACTION, action))
    return views
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount(): Int = 1

  override fun getItemId(position: Int): Long = position.toLong()

  override fun hasStableIds(): Boolean = false
}

/** The disc widget (the cover as a record, play and next). */
class DiscWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetManager.updateAppWidget(appWidgetIds, Widgets.disc(context))
  }
}

/** The rectangle widget (cover on the left, song, previous / play / next). */
class RectangleWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetManager.updateAppWidget(appWidgetIds, Widgets.rectangle(context))
  }
}
