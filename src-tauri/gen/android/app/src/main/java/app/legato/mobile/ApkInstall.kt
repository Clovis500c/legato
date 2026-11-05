package app.legato.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

// Phone updates (src-tauri/src/mobile/update.rs, over JNI): the downloaded APK handed to Android's installer, which asks
// the user. First time: Android's "Install unknown apps" page for Legato, then the installer as the user comes back.
// Android opens nothing for an app off screen: an APK downloaded behind other apps waits for Legato's return.
object ApkInstall {
  // The APK waiting for Legato on screen, and whether Android's permission page was opened for it.
  @Volatile private var waiting: File? = null
  @Volatile private var askedAllow = false

  // "ok": installer open; "allow": Android's permission page open first; "later": opens as Legato comes back;
  // "refused": not an APK of ours.
  @JvmStatic
  fun install(context: Context, path: String): String {
    val apk = File(path).canonicalFile
    if (apk.parentFile != File(context.cacheDir, "updates").canonicalFile || !apk.name.endsWith(".apk") || !apk.isFile) return "refused"
    askedAllow = false
    if (!MainActivity.onScreen) {
      waiting = apk
      return "later"
    }
    return open(context, apk)
  }

  // MainActivity.onResume: the APK left waiting. Back from the permission page without allowing: dropped (no loop on
  // that page), Settings › About keeps its button.
  @JvmStatic
  fun resumed(context: Context) {
    val apk = waiting ?: return
    if (askedAllow && !context.packageManager.canRequestPackageInstalls()) {
      waiting = null
      askedAllow = false
      return
    }
    try {
      open(context, apk)
    } catch (e: Exception) {
      waiting = null
    }
  }

  private fun open(context: Context, apk: File): String {
    if (!context.packageManager.canRequestPackageInstalls()) {
      waiting = apk
      askedAllow = true
      context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      return "allow"
    }
    waiting = null
    askedAllow = false
    // file_paths.xml shares the cache folder.
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
    context.startActivity(view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
    return "ok"
  }
}
