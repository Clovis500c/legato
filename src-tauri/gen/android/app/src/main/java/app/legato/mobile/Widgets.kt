package app.legato.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.view.View
import android.widget.RemoteViews

// Home-screen widgets. They only draw what `MediaState` already holds (what the page said is playing, its cover from the
// art cache): no network, no secret. Their buttons send the notification's actions to PlaybackService, which hands them to
// the page. Nothing is placed, nothing changes: a provider with no widget on the screen is never asked to draw.
object Widgets {
  /** Every widget redrawn from what plays now (PlaybackService calls it on each change). */
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    redraw(context, manager, RectangleWidget::class.java) { rectangle(context) }
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

/** The rectangle widget (cover on the left, song, previous / play / next). */
class RectangleWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetManager.updateAppWidget(appWidgetIds, Widgets.rectangle(context))
  }
}
