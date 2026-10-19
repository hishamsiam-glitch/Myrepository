package sa.com.ughi.saleshub

import android.app.Application
import android.webkit.CookieManager

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // Cookies (session + the long-lived "remember this phone" token) persist across launches by default.
        CookieManager.getInstance().setAcceptCookie(true)
    }
}
