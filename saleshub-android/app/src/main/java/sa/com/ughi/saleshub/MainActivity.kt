package sa.com.ughi.saleshub

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Sales HUB for Android: a hardened WebView around https://saleshub.gulfhygienic.com.sa.
 *  - sign in once (code + authenticator, "Keep me signed in on this phone" is pre-ticked for the app) -> later launches
 *    open straight into the user's own view; the portal decides what each role sees.
 *  - only the portal host is loaded inside the app; any other link opens in the phone's browser.
 *  - Excel exports go through Android's download manager (with the session cookie) into Downloads.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var progress: ProgressBar
    private lateinit var offline: View
    private val portalHost = Uri.parse(BuildConfig.PORTAL_URL).host!!

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web); swipe = findViewById(R.id.swipe); progress = findViewById(R.id.progress); offline = findViewById(R.id.offline)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
            userAgentString = "$userAgentString SalesHUBApp/${BuildConfig.VERSION_NAME}"   // the portal pre-ticks "keep me signed in" for the app
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.addJavascriptInterface(FileBridge(this), "SalesHUBApp")          // only portal pages are ever loaded, so the bridge is not exposed to third parties

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "https" && u.host.equals(portalHost, ignoreCase = true)) return false   // stay inside the app
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }                            // anything else -> system browser / mail
                return true
            }
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) { offline.visibility = View.GONE }
            override fun onPageFinished(view: WebView?, url: String?) { swipe.isRefreshing = false; CookieManager.getInstance().flush() }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) { swipe.isRefreshing = false; offline.visibility = View.VISIBLE }
            }
        }
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val req = DownloadManager.Request(Uri.parse(url)).apply {
                addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                addRequestHeader("User-Agent", userAgent)
                setMimeType(mimeType)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, contentDisposition, mimeType))
            }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show()
        }

        swipe.setColorSchemeResources(R.color.indigo, R.color.orange)
        swipe.setOnRefreshListener { web.reload() }
        findViewById<View>(R.id.retry).setOnClickListener { offline.visibility = View.GONE; web.loadUrl(BuildConfig.PORTAL_URL) }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else { isEnabled = false; onBackPressedDispatcher.onBackPressed() } }
        })

        if (savedInstanceState == null) web.loadUrl(intent?.data?.takeIf { it.host.equals(portalHost, true) }?.toString() ?: BuildConfig.PORTAL_URL)
        else web.restoreState(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.takeIf { it.host.equals(portalHost, true) }?.let { web.loadUrl(it.toString()) }
    }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    override fun onPause() { super.onPause(); CookieManager.getInstance().flush() }
}
