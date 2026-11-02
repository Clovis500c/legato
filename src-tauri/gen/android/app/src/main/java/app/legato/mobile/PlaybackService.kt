package app.legato.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

// Music behind other apps: a media playback foreground service keeps the process alive (not frozen, not killed).
// MainActivity starts it while on screen; off screen and silent, it stops within a minute. Its notification opens the app.
class PlaybackService : Service() {
  private val tick = Handler(Looper.getMainLooper())
  private val check = object : Runnable {
    override fun run() {
      val audio = getSystemService(AudioManager::class.java)
      if (!MainActivity.onScreen && !audio.isMusicActive) stopSelf() else tick.postDelayed(this, 60_000)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    getSystemService(NotificationManager::class.java)
      .createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.app_name), NotificationManager.IMPORTANCE_LOW))
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val notification = Notification.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(getString(R.string.app_name))
      .setContentIntent(open)
      .setOngoing(true)
      .build()
    try {
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

  override fun onDestroy() {
    tick.removeCallbacks(check)
    super.onDestroy()
  }

  private companion object {
    const val CHANNEL = "playback"
  }
}
