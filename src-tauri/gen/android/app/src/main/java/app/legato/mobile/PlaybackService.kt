package app.legato.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

// Music behind other apps: a media playback foreground service keeps the process alive (not frozen, not killed).
// MainActivity starts it while on screen; off screen and silent, it stops within a minute. Its notification is a media
// one (previous, play / pause, next, title, artist, cover) and a MediaSession serves the lock screen and headset buttons:
// every button goes back to the page (`MediaState`), which owns the queue.
class PlaybackService : Service() {
  private val tick = Handler(Looper.getMainLooper())
  private var session: MediaSession? = null
  private var wake: PowerManager.WakeLock? = null
  private var wifi: WifiManager.WifiLock? = null
  private val check = object : Runnable {
    override fun run() {
      val audio = getSystemService(AudioManager::class.java)
      if (!MainActivity.onScreen && !audio.isMusicActive) stopSelf()
      else {
        hold(MediaState.playing)
        tick.postDelayed(this, 60_000)
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    intent?.getStringExtra(ACTION)?.let { MediaState.toPage(it) }
    getSystemService(NotificationManager::class.java)
      .createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.app_name), NotificationManager.IMPORTANCE_LOW))
    if (session == null) {
      session = MediaSession(this, "legato").apply {
        setCallback(object : MediaSession.Callback() {
          override fun onPlay() = MediaState.toPage("play")
          override fun onPause() = MediaState.toPage("pause")
          override fun onSkipToNext() = MediaState.toPage("next")
          override fun onSkipToPrevious() = MediaState.toPage("previous")
          override fun onSeekTo(pos: Long) = MediaState.toPage("seek:$pos")
        })
      }
      MediaState.onChange = { tick.post { refresh() } }
    }
    try {
      val notification = build()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      else startForeground(1, notification)
    } catch (e: Exception) {
      stopSelf()
      return START_NOT_STICKY
    }
    tick.removeCallbacks(check)
    tick.postDelayed(check, 60_000)
    return START_NOT_STICKY
  }

  private fun refresh() {
    hold(MediaState.playing)
    try {
      getSystemService(NotificationManager::class.java).notify(1, build())
    } catch (e: Exception) {
    }
  }

  // Screen off: the CPU and the Wi-Fi stay awake while a song plays, so the page loads the next one in time; both go as
  // it stops. The time limit is a net, renewed by every change and the minute check.
  @Suppress("DEPRECATION")
  private fun hold(playing: Boolean) {
    if (playing && wake == null) {
      wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "legato:playback").apply { setReferenceCounted(false) }
      wifi = applicationContext.getSystemService(WifiManager::class.java)?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "legato:playback")?.apply { setReferenceCounted(false) }
    }
    wake?.let { if (playing) it.acquire(10 * 60_000L) else if (it.isHeld) it.release() }
    wifi?.let { if (playing && !it.isHeld) it.acquire() else if (!playing && it.isHeld) it.release() }
  }

  private fun button(icon: Int, label: String, action: String, code: Int): Notification.Action {
    val pi = PendingIntent.getService(this, code, Intent(this, PlaybackService::class.java).putExtra(ACTION, action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    return Notification.Action.Builder(Icon.createWithResource(this, icon), label, pi).build()
  }

  private fun build(): Notification {
    val title = MediaState.title
    val playing = MediaState.playing
    val position = if (playing) MediaState.positionMs + (System.currentTimeMillis() - MediaState.stamp) else MediaState.positionMs
    val cover = MediaState.cover
    session?.let {
      it.setMetadata(
        MediaMetadata.Builder().apply {
          putString(MediaMetadata.METADATA_KEY_TITLE, title ?: getString(R.string.app_name))
          putString(MediaMetadata.METADATA_KEY_ARTIST, MediaState.artist ?: "")
          if (MediaState.durationMs > 0) putLong(MediaMetadata.METADATA_KEY_DURATION, MediaState.durationMs)
          if (cover != null) putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cover)
        }.build()
      )
      it.setPlaybackState(
        PlaybackState.Builder()
          .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO)
          .setState(if (title == null) PlaybackState.STATE_NONE else if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, position, 1f)
          .build()
      )
      it.isActive = title != null
    }
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val b = Notification.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(title ?: getString(R.string.app_name))
      .setContentIntent(open)
      .setOngoing(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
    if (title != null) {
      b.setContentText(MediaState.artist ?: "")
      if (cover != null) b.setLargeIcon(cover)
      b.addAction(button(android.R.drawable.ic_media_previous, "Previous", "previous", 1))
        .addAction(if (playing) button(android.R.drawable.ic_media_pause, "Pause", "pause", 2) else button(android.R.drawable.ic_media_play, "Play", "play", 3))
        .addAction(button(android.R.drawable.ic_media_next, "Next", "next", 4))
      val style = Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2)
      session?.let { style.setMediaSession(it.sessionToken) }
      b.setStyle(style)
    }
    return b.build()
  }

  override fun onDestroy() {
    tick.removeCallbacks(check)
    hold(false)
    MediaState.onChange = null
    session?.release()
    session = null
    super.onDestroy()
  }

  private companion object {
    const val CHANNEL = "playback"
    const val ACTION = "legato.action"
  }
}
