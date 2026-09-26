package com.hishamsiam.appguard

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Sends approval requests and turns approver replies into approvals.
 * All network work runs on a single background thread; callbacks are posted
 * to the main thread.
 */
object MailPoller {
    private const val TAG = "AppGuard.Mail"
    const val ACTION_POLICY_CHANGED = "com.hishamsiam.appguard.POLICY_CHANGED"

    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val polling = AtomicBoolean(false)

    /** Sends a request email for [target]; reuses an existing pending request when one exists. */
    fun requestApproval(ctx: Context, target: Target, callback: (Result<PendingRequest>) -> Unit) {
        val app = ctx.applicationContext
        val store = Store.get(app)
        val policy = Policy(app)
        executor.execute {
            val result = runCatching {
                val cfg = store.mailConfig
                if (!cfg.isConfigured) throw IllegalStateException(app.getString(R.string.request_no_mail))
                val existing = store.pendingFor(target)
                val req = existing ?: PendingRequest(store.newRequestCode(), target, policy.labelFor(target), System.currentTimeMillis())
                MailClient(cfg).sendRequest(store.approverEmail, req, store.defaultMinutes, deviceName())
                store.putPending(req)
                req
            }
            main.post { callback(result) }
        }
    }

    /** Checks the inbox once. [callback] receives a short human-readable summary. */
    fun pollNow(ctx: Context, callback: ((String) -> Unit)? = null) {
        val app = ctx.applicationContext
        if (!polling.compareAndSet(false, true)) {
            callback?.let { main.post { it("Already checking…") } }
            return
        }
        executor.execute {
            val summary = try { doPoll(app) } catch (e: Exception) {
                Log.w(TAG, "poll failed", e)
                "Mailbox check failed: ${e.message ?: e.javaClass.simpleName}"
            } finally { polling.set(false) }
            Store.get(app).lastPollTime = System.currentTimeMillis()
            Store.get(app).lastPollResult = summary
            callback?.let { cb -> main.post { cb(summary) } }
        }
    }

    private fun doPoll(app: Context): String {
        val store = Store.get(app)
        val policy = Policy(app)
        val cfg = store.mailConfig
        if (!cfg.isConfigured) return "Mailbox not configured"

        // Expired approvals are pruned on every poll so the UI stays honest.
        val expired = store.pruneExpired()
        if (expired.isNotEmpty()) notifyChanged(app)

        val since = maxOf(store.installTime, System.currentTimeMillis() - 3L * 24 * 60 * 60 * 1000)
        val mails = MailClient(cfg).fetchFrom(store.approverEmail, since)
        var applied = 0
        for (m in mails) {
            if (m.isOwnRequest) continue
            if (store.isProcessed(m.messageId)) continue
            store.markProcessed(m.messageId)
            if (!SenderAuth.passes(m, store.approverEmail, store.strictAuth)) {
                Log.w(TAG, "ignoring message from ${m.from} without passing authentication results")
                continue
            }
            val cmd = ApprovalParser.parse(m.subject, m.body) ?: continue
            if (apply(app, store, policy, cmd)) applied++
        }
        if (applied > 0) notifyChanged(app)
        return if (applied == 0) "Checked ${fmt(System.currentTimeMillis())}: no new approvals"
        else "Checked ${fmt(System.currentTimeMillis())}: $applied change(s) applied"
    }

    /** Applies one parsed command; returns true when policy changed or a request was closed. */
    fun apply(app: Context, store: Store, policy: Policy, cmd: Command): Boolean {
        val pendingByCode = cmd.code?.let { store.pendingByCode(it) }
        val explicit = cmd.targetText?.let { policy.resolveTarget(it) }
        when (cmd.action) {
            Command.Action.APPROVE -> {
                val target = explicit?.also { store.removePendingFor(it) }
                    ?: pendingByCode?.target
                    ?: store.pendingRequests().singleOrNull()?.target
                    ?: return false
                val minutes = cmd.minutes ?: store.defaultMinutes
                val a = policy.grant(target, minutes, "email")
                Notifier.notify(app, target.key.hashCode(),
                    app.getString(R.string.notif_approved, a.label, fmt(a.expiresAt)),
                    "${a.label} (${target.id}) – $minutes min")
                return true
            }
            Command.Action.DENY -> {
                val req = pendingByCode ?: explicit?.let { store.pendingFor(it) } ?: store.pendingRequests().singleOrNull() ?: return false
                store.removePending(req.code)
                Notifier.notify(app, req.target.key.hashCode(), app.getString(R.string.notif_denied, req.label), req.target.id)
                return true
            }
            Command.Action.REVOKE -> {
                val target = explicit ?: pendingByCode?.target ?: return false
                policy.revoke(target)
                store.removePendingFor(target)
                Notifier.notify(app, target.key.hashCode(), app.getString(R.string.notif_revoked, policy.labelFor(target)), target.id)
                return true
            }
            Command.Action.LOCK -> {
                policy.revokeAll()
                Notifier.notify(app, 1, app.getString(R.string.notif_revoked, "Everything"), "All approvals revoked by the administrator")
                return true
            }
        }
    }

    fun notifyChanged(app: Context) {
        app.sendBroadcast(Intent(ACTION_POLICY_CHANGED).setPackage(app.packageName))
    }

    fun fmt(t: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(t))
    fun fmtDateTime(t: Long): String = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(t))

    private fun deviceName(): String =
        "${Build.MANUFACTURER} ${Build.MODEL}".trim().replaceFirstChar { it.uppercase() }
}
