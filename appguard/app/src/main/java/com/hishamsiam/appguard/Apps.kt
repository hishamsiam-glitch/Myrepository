package com.hishamsiam.appguard

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import android.telecom.TelecomManager
import android.view.inputmethod.InputMethodManager

/** Package-manager helpers: labels, icons, and the system packages that must never be blocked. */
object Apps {

    /** Known browsers and the view id of their address bar. */
    val BROWSERS: Map<String, List<String>> = mapOf(
        "com.android.chrome" to listOf("com.android.chrome:id/url_bar"),
        "com.chrome.beta" to listOf("com.chrome.beta:id/url_bar"),
        "com.chrome.dev" to listOf("com.chrome.dev:id/url_bar"),
        "com.chrome.canary" to listOf("com.chrome.canary:id/url_bar"),
        "com.google.android.apps.chrome" to listOf("com.google.android.apps.chrome:id/url_bar"),
        "org.chromium.chrome" to listOf("org.chromium.chrome:id/url_bar"),
        "org.mozilla.firefox" to listOf("org.mozilla.firefox:id/mozac_browser_toolbar_url_view", "org.mozilla.firefox:id/url_bar_title"),
        "org.mozilla.firefox_beta" to listOf("org.mozilla.firefox_beta:id/mozac_browser_toolbar_url_view"),
        "org.mozilla.fenix" to listOf("org.mozilla.fenix:id/mozac_browser_toolbar_url_view"),
        "org.mozilla.focus" to listOf("org.mozilla.focus:id/mozac_browser_toolbar_url_view", "org.mozilla.focus:id/display_url"),
        "com.sec.android.app.sbrowser" to listOf("com.sec.android.app.sbrowser:id/location_bar_edit_text"),
        "com.sec.android.app.sbrowser.beta" to listOf("com.sec.android.app.sbrowser.beta:id/location_bar_edit_text"),
        "com.microsoft.emmx" to listOf("com.microsoft.emmx:id/url_bar"),
        "com.brave.browser" to listOf("com.brave.browser:id/url_bar"),
        "com.opera.browser" to listOf("com.opera.browser:id/url_field"),
        "com.opera.mini.native" to listOf("com.opera.mini.native:id/url_field"),
        "com.opera.gx" to listOf("com.opera.gx:id/addressbarEdit"),
        "com.duckduckgo.mobile.android" to listOf("com.duckduckgo.mobile.android:id/omnibarTextInput"),
        "com.kiwibrowser.browser" to listOf("com.kiwibrowser.browser:id/url_bar"),
        "com.vivaldi.browser" to listOf("com.vivaldi.browser:id/url_bar"),
        "com.mi.globalbrowser" to listOf("com.mi.globalbrowser:id/url"),
        "com.android.browser" to listOf("com.android.browser:id/url"),
        "com.UCMobile.intl" to listOf("com.UCMobile.intl:id/url"),
        "com.yandex.browser" to listOf("com.yandex.browser:id/bro_omnibar_address_title_text"),
        "com.ecosia.android" to listOf("com.ecosia.android:id/url_bar"),
        "com.huawei.browser" to listOf("com.huawei.browser:id/url_text_view"),
        "com.hihonor.browser" to listOf("com.hihonor.browser:id/url_text_view"),
        "com.heytap.browser" to listOf("com.heytap.browser:id/addressbar_title"),
        "com.coloros.browser" to listOf("com.coloros.browser:id/addressbar_title"),
        "com.vivo.browser" to listOf("com.vivo.browser:id/title"),
        "com.microsoft.bing" to listOf("com.microsoft.bing:id/url_bar"),
        "com.cloudmosa.puffinFree" to listOf("com.cloudmosa.puffinFree:id/url_bar"),
        "com.aloha.browser" to listOf("com.aloha.browser:id/address_bar_text"),
        "org.torproject.torbrowser" to listOf("org.torproject.torbrowser:id/mozac_browser_toolbar_url_view"),
    )

    fun isBrowser(pkg: String) = BROWSERS.containsKey(pkg)

    /** Packages that are part of the operating system UI and must always be allowed. */
    private val STATIC_SYSTEM = setOf(
        "android",
        "com.android.systemui",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.android.incallui",
        "com.android.phone",
        "com.android.server.telecom",
        "com.samsung.android.incallui",
        "com.android.emergency",
        "com.android.cellbroadcastreceiver",
        "com.google.android.cellbroadcastreceiver",
        "com.android.providers.downloads.ui",
        "com.google.android.gms",          // sign-in / permission prompts
        "com.google.android.gsf",
        "com.android.captiveportallogin",
        "com.android.intentresolver",
        "com.android.shell",
        "com.samsung.android.app.cocktailbarservice",
        "com.sec.android.app.launcher",
    )

    @Volatile private var cachedSystem: Set<String>? = null
    @Volatile private var cachedAt = 0L

    /** Own app + launchers + IMEs + dialer + static system list. Cached for a minute. */
    fun systemPackages(ctx: Context): Set<String> {
        val now = System.currentTimeMillis()
        cachedSystem?.let { if (now - cachedAt < 60_000) return it }
        val set = HashSet(STATIC_SYSTEM)
        set.add(ctx.packageName)
        val pm = ctx.packageManager
        try {
            val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            pm.queryIntentActivities(home, PackageManager.MATCH_ALL).forEach { set.add(it.activityInfo.packageName) }
            pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.let { set.add(it.activityInfo.packageName) }
        } catch (_: Exception) {}
        try {
            val imm = ctx.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.enabledInputMethodList.forEach { set.add(it.packageName) }
        } catch (_: Exception) {}
        try {
            val tm = ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            tm.defaultDialerPackage?.let { set.add(it) }
            tm.systemDialerPackage?.let { set.add(it) }
        } catch (_: Exception) {}
        cachedSystem = set
        cachedAt = now
        return set
    }

    fun label(ctx: Context, pkg: String): String = try {
        val pm = ctx.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) { pkg }

    fun icon(ctx: Context, pkg: String): Drawable? = try {
        ctx.packageManager.getApplicationIcon(pkg)
    } catch (_: Exception) { null }

    fun isInstalled(ctx: Context, pkg: String): Boolean = try {
        ctx.packageManager.getApplicationInfo(pkg, 0); true
    } catch (_: Exception) { false }

    data class Entry(val pkg: String, val label: String, val system: Boolean)

    /** Every app with a launcher icon, sorted by label. */
    fun launchable(ctx: Context): List<Entry> {
        val pm = ctx.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val seen = HashSet<String>()
        val out = ArrayList<Entry>()
        for (ri in pm.queryIntentActivities(intent, PackageManager.MATCH_ALL)) {
            val ai = ri.activityInfo.applicationInfo
            if (!seen.add(ai.packageName)) continue
            out.add(Entry(ai.packageName, pm.getApplicationLabel(ai).toString(), (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0))
        }
        return out.sortedBy { it.label.lowercase() }
    }

    /** Resolve a free-text name ("Instagram", "com.instagram.android") to an installed package. */
    fun findPackage(ctx: Context, text: String): String? {
        val t = text.trim()
        if (t.isEmpty()) return null
        if (isInstalled(ctx, t)) return t
        val lower = t.lowercase()
        val apps = launchable(ctx)
        apps.firstOrNull { it.label.equals(t, ignoreCase = true) }?.let { return it.pkg }
        apps.firstOrNull { it.pkg.lowercase() == lower }?.let { return it.pkg }
        apps.firstOrNull { it.label.lowercase().startsWith(lower) }?.let { return it.pkg }
        return null
    }
}
