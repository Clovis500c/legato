package app.legato.mobile

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

// Phone updates downloading (src-tauri/src/mobile/update.rs, over JNI, about once a second): a data sync foreground
// service keeps the process alive behind other apps while the APK comes, its notification "<done> / <total>" with a
// progress bar. Done: the service stops and a notification of its own stays, the bar full, a tap opens Legato (Android's
// installer waits there: ApkInstall). Failed: nothing left. The version and numbers only: no words to translate.
class UpdateService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val n = build(this, intent?.getStringExtra(TITLE) ?: "", intent?.getStringExtra(TEXT) ?: "", intent?.getIntExtra(PERMILLE, 0) ?: 0)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      else startForeground(ID, n)
    } catch (e: Exception) {
      running = false
      stopSelf()
    }
    return START_NOT_STICKY
  }

  companion object {
    private const val CHANNEL = "updates"
    private const val ID = 2
    private const val READY = 3
    private const val TITLE = "title"
    private const val TEXT = "text"
    private const val PERMILLE = "permille"
    @Volatile private var running = false

    // permille 0..999: downloading; 1000: done; below 0: gone.
    @JvmStatic
    fun show(context: Context, title: String, text: String, permille: Int) {
      val nm = context.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.app_name), NotificationManager.IMPORTANCE_LOW))
      if (permille < 0 || permille >= 1000) {
        running = false
        context.stopService(Intent(context, UpdateService::class.java))
        if (permille >= 1000) nm.notify(READY, build(context, title, text, 1000))
        return
      }
      if (running) {
        nm.notify(ID, build(context, title, text, permille))
        return
      }
      running = true
      nm.cancel(READY)
      ask(context)
      val start = Intent(context, UpdateService::class.java).putExtra(TITLE, title).putExtra(TEXT, text).putExtra(PERMILLE, permille)
      try {
        context.startForegroundService(start)
      } catch (e: Exception) {
        running = false
      }
    }

    // Android 13 on shows notifications only once allowed: asked as the first download starts (a tap on Update).
    private fun ask(context: Context) {
      if (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
      val activity = context as? Activity ?: return
      activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 41) }
    }

    private fun build(context: Context, title: String, text: String, permille: Int): Notification {
      val done = permille >= 1000
      val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
      return Notification.Builder(context, CHANNEL)
        .setSmallIcon(if (done) android.R.drawable.stat_sys_download_done else android.R.drawable.stat_sys_download)
        .setContentTitle(title)
        .setContentText(text)
        .setProgress(1000, permille.coerceIn(0, 1000), false)
        .setContentIntent(open)
        .setOngoing(!done)
        .setAutoCancel(done)
        .setOnlyAlertOnce(true)
        .build()
    }
  }
}
