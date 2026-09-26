package com.hishamsiam.appguard

import android.content.Context

/**
 * Decides what is allowed right now. Everything is blocked unless it is a
 * system package, an always-allowed package, or has an unexpired approval.
 */
class Policy(private val ctx: Context) {
    private val store = Store.get(ctx)

    fun isAppAllowed(pkg: String): Boolean {
        if (!store.protectionEnabled) return true
        if (Apps.systemPackages(ctx).contains(pkg)) return true
        if (store.alwaysAllowedPackages.contains(pkg)) return true
        if (store.browsersAllowed && Apps.isBrowser(pkg)) return true
        val a = store.approvalFor(Target.app(pkg)) ?: return false
        return a.isActive
    }

    fun isHostAllowed(host: String): Boolean {
        if (!store.protectionEnabled) return true
        val h = Domains.normalize(host)
        if (h.isEmpty()) return true
        for (a in store.activeApprovals()) {
            if (a.target.kind == Kind.WEB && Domains.matches(h, a.target.id)) return true
        }
        return false
    }

    /** True when the target used to be approved but the time ran out. */
    fun hasExpired(target: Target): Boolean = store.approvalFor(target)?.let { !it.isActive } ?: false

    fun grant(target: Target, minutes: Int, source: String, label: String? = null): Approval {
        val now = System.currentTimeMillis()
        val mins = minutes.coerceIn(1, 30 * 24 * 60)
        val a = Approval(
            target = target,
            label = label ?: labelFor(target),
            grantedAt = now,
            expiresAt = now + mins * 60_000L,
            source = source,
        )
        store.putApproval(a)
        store.removePendingFor(target)
        return a
    }

    fun revoke(target: Target) {
        store.removeApproval(target)
    }

    fun revokeAll() = store.clearApprovals()

    fun labelFor(target: Target): String = when (target.kind) {
        Kind.APP -> Apps.label(ctx, target.id)
        Kind.WEB -> target.id
    }

    /**
     * Resolve free text from an email ("youtube.com", "Instagram",
     * "com.instagram.android", "app:com.x", "web:x.com") into a target.
     */
    fun resolveTarget(text: String): Target? {
        val t = text.trim().trim('"', '\'', '<', '>', ',', ';', '.')
        if (t.isEmpty()) return null
        if (t.startsWith("app:", true)) return Target.app(t.substring(4))
        if (t.startsWith("web:", true) || t.startsWith("site:", true)) return Target.web(t.substringAfter(':'))
        if (t.startsWith("http://", true) || t.startsWith("https://", true)) return Target.web(t)
        Apps.findPackage(ctx, t)?.let { return Target.app(it) }
        if (Domains.looksLikeHost(t)) return Target.web(t)
        return null
    }
}
