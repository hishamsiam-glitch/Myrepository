package sa.com.ughi.saleshub

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File

/** window.SalesHUBApp.saveFile(name, text): the portal's "Export to Excel" (CSV) lands in the phone's Downloads folder. */
class FileBridge(private val ctx: Context) {
    @JavascriptInterface
    fun saveFile(name: String, text: String) {
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "export.csv" }
        runCatching {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safe)
                put(MediaStore.Downloads.MIME_TYPE, "text/csv")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + File.separator + "Sales HUB")
            }
            val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("no uri")
            ctx.contentResolver.openOutputStream(uri)!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            android.os.Handler(ctx.mainLooper).post { Toast.makeText(ctx, "Saved to Downloads/Sales HUB/$safe", Toast.LENGTH_LONG).show() }
        }.onFailure { android.os.Handler(ctx.mainLooper).post { Toast.makeText(ctx, "Could not save file", Toast.LENGTH_SHORT).show() } }
    }
}
