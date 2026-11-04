package app.legato.mobile

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File

// Android's picker gives content:// addresses, and the app's commands read and write paths. Called from Rust
// (`src-tauri/src/mobile/picked.rs`) over JNI: a picked document is copied into the app's cache, and a file written
// there is copied out to the address the user chose to save it at.
object PickedFile {
  /** The document's own name (its provider's), null when it has none. */
  private fun name(context: Context, uri: Uri): String? =
    runCatching {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    }.getOrNull()

  /** Copies the document into dir under its own name (its last part only); the copy's path, null when unreadable. */
  @JvmStatic
  fun copyIn(context: Context, address: String, dir: String): String? =
    runCatching {
      val uri = Uri.parse(address)
      val own = name(context, uri)?.substringAfterLast('/')?.trim()?.takeIf { it.isNotEmpty() && it != "." && it != ".." }
      val out = File(dir, own ?: "picked")
      context.contentResolver.openInputStream(uri)!!.use { input -> out.outputStream().use { input.copyTo(it) } }
      out.absolutePath
    }.getOrNull()

  /** Writes the file at path to the address ("wt": what was there goes); the document's name, null when refused. */
  @JvmStatic
  fun copyOut(context: Context, path: String, address: String): String? =
    runCatching {
      val uri = Uri.parse(address)
      context.contentResolver.openOutputStream(uri, "wt")!!.use { out -> File(path).inputStream().use { it.copyTo(out) } }
      name(context, uri) ?: File(path).name
    }.getOrNull()
}
