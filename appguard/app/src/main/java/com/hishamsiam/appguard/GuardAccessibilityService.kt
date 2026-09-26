package com.hishamsiam.appguard

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

/**
 * Watches what is on screen. Any app or website that is not allowed by
 * [Policy] gets covered by [BlockedActivity]. The service also hosts the
 * timers that expire approvals and poll the mailbox while it is running.
 */
class GuardAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "AppGuard.A11y"
        @Volatile var instance: GuardAccessibilityService? = null
        val isRunning: Boolean get() = instance != null
        private const val TICK_MS = 20_000L
        private const val DEBOUNCE_MS = 1_500L
    }

    private lateinit var store: Store
    private lateinit var policy: Policy
    private val handler = Handler(Looper.getMainLooper())
    private var lastBlockKey: String? = null
    private var lastBlockAt = 0L
    private var lastPollAt = 0L

    private val tick = object : Runnable {
        override fun run() {
            try { periodic() } catch (e: Exception) { Log.w(TAG, "tick failed", e) }
            handler.postDelayed(this, TICK_MS)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        store = Store.get(this)
        policy = Policy(this)
        instance = this
        serviceInfo = (serviceInfo ?: AccessibilityServiceInfo()).apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
            notificationTimeout = 150
        }
        handler.removeCallbacks(tick)
        handler.postDelayed(tick, TICK_MS)
        MailPollJob.schedule(this)
        Log.i(TAG, "connected")
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        instance = null
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (!::store.isInitialized) return
        if (!store.protectionEnabled || !store.hasPin) return
        val evPkg = event.packageName?.toString() ?: return
        if (evPkg == packageName) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                // Event package for state changes is reliable enough for the app gate.
                val fg = foregroundPackage() ?: evPkg
                evaluate(fg)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                // Only browsers need content inspection; and only when they are actually in front.
                if (!Apps.isBrowser(evPkg)) return
                val fg = foregroundPackage() ?: return
                if (fg != evPkg) return
                evaluate(fg)
            }
        }
    }

    /** Runs every [TICK_MS]: expire approvals and re-check the app in front even without UI events. */
    private fun periodic() {
        if (!store.protectionEnabled || !store.hasPin) return
        val expired = store.pruneExpired()
        if (expired.isNotEmpty()) {
            MailPoller.notifyChanged(this)
            for (a in expired) Notifier.notify(this, a.target.key.hashCode(), getString(R.string.notif_revoked, a.label), a.target.id)
        }
        foregroundPackage()?.let { if (it != packageName) evaluate(it) }

        // Adaptive mailbox polling: every minute while a request is waiting, else the configured interval.
        val pending = store.pendingRequests()
        val recentPending = pending.any { System.currentTimeMillis() - it.createdAt < 45 * 60_000L }
        val interval = if (recentPending) 60_000L else store.pollMinutes * 60_000L
        if (store.mailConfig.isConfigured && System.currentTimeMillis() - lastPollAt >= interval) {
            lastPollAt = System.currentTimeMillis()
            MailPoller.pollNow(this)
        }
    }

    private fun evaluate(pkg: String) {
        if (pkg == packageName) return
        if (Apps.isBrowser(pkg)) {
            if (!store.browsersAllowed && !policy.isAppAllowed(pkg)) { block(Target.app(pkg), pkg); return }
            val host = currentBrowserHost(pkg) ?: return
            if (!policy.isHostAllowed(host)) block(Target.web(host), pkg)
            return
        }
        if (!policy.isAppAllowed(pkg)) block(Target.app(pkg), pkg)
    }

    private fun block(target: Target, sourcePkg: String) {
        val now = System.currentTimeMillis()
        if (target.key == lastBlockKey && now - lastBlockAt < DEBOUNCE_MS) return
        lastBlockKey = target.key
        lastBlockAt = now
        Log.i(TAG, "blocking ${target.key}")
        val i = Intent(this, BlockedActivity::class.java)
            .putExtra(BlockedActivity.EXTRA_KIND, target.kind.name)
            .putExtra(BlockedActivity.EXTRA_ID, target.id)
            .putExtra(BlockedActivity.EXTRA_SOURCE_PKG, sourcePkg)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        try { startActivity(i) } catch (e: Exception) { Log.w(TAG, "cannot start block screen", e) }
    }

    /** Package of the focused application window, ignoring keyboards and system overlays. */
    private fun foregroundPackage(): String? {
        try {
            val ws = windows ?: return rootInActiveWindow?.packageName?.toString()
            var fallback: String? = null
            for (w in ws) {
                if (w.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
                val p = w.root?.packageName?.toString() ?: continue
                if (w.isFocused || w.isActive) return p
                if (fallback == null) fallback = p
            }
            return fallback ?: rootInActiveWindow?.packageName?.toString()
        } catch (_: Exception) {
            return rootInActiveWindow?.packageName?.toString()
        }
    }

    /** Reads the address bar of a known browser and returns the host it shows, if any. */
    private fun currentBrowserHost(pkg: String): String? {
        val root = rootInActiveWindow ?: return null
        if (root.packageName?.toString() != pkg) return null
        try {
            for (id in Apps.BROWSERS[pkg] ?: emptyList()) {
                val nodes = root.findAccessibilityNodeInfosByViewId(id) ?: continue
                for (n in nodes) {
                    val text = n.text?.toString() ?: n.contentDescription?.toString() ?: continue
                    val host = hostOf(text)
                    if (host != null) return host
                }
            }
            // Unknown layout: look for an editable field that holds a URL.
            return findUrlField(root, 0)
        } catch (_: Exception) {
            return null
        }
    }

    private fun findUrlField(node: AccessibilityNodeInfo?, depth: Int): String? {
        if (node == null || depth > 14) return null
        val cls = node.className?.toString() ?: ""
        if (node.isEditable || cls.endsWith("EditText") || cls.endsWith("UrlBar")) {
            node.text?.toString()?.let { t -> hostOf(t)?.let { return it } }
        }
        for (i in 0 until node.childCount) {
            val h = findUrlField(node.getChild(i), depth + 1)
            if (h != null) return h
        }
        return null
    }

    private fun hostOf(text: String): String? {
        val t = text.trim()
        if (t.isEmpty() || t.contains(' ') && !t.startsWith("http")) return null
        val host = Domains.normalize(t.substringBefore(' '))
        return if (Domains.looksLikeHost(host)) host else null
    }

    /** Used by the block screen's "Go back" button to leave the blocked page inside the browser. */
    fun goBack() { performGlobalAction(GLOBAL_ACTION_BACK) }
    fun goHome() { performGlobalAction(GLOBAL_ACTION_HOME) }
}
