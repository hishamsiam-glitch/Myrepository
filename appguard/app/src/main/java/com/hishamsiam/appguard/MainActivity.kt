package com.hishamsiam.appguard

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var store: Store
    private lateinit var policy: Policy

    private val changeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { refresh() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = Store.get(this)
        policy = Policy(this)

        findViewById<Button>(R.id.btnCheckMail).setOnClickListener {
            it.isEnabled = false
            MailPoller.pollNow(this) { msg -> it.isEnabled = true; Toast.makeText(this, msg, Toast.LENGTH_LONG).show(); refresh() }
        }
        findViewById<Button>(R.id.btnUnlockSettings).setOnClickListener {
            PinDialog.verify(this) {
                policy.grant(Target.app("com.android.settings"), 10, "admin", "Android Settings")
                MailPoller.notifyChanged(this)
                refresh()
                Toast.makeText(this, "Settings unlocked for 10 minutes", Toast.LENGTH_SHORT).show()
            }
        }
        findViewById<Button>(R.id.btnAdmin).setOnClickListener {
            PinDialog.verify(this) { startActivity(Intent(this, SettingsActivity::class.java)) }
        }

        if (!store.hasPin) PinDialog.create(this) { refresh() }
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter(MailPoller.ACTION_POLICY_CHANGED)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(changeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(changeReceiver, filter)
        refresh()
    }

    override fun onPause() {
        super.onPause()
        runCatching { unregisterReceiver(changeReceiver) }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
    }

    // ------------------------------------------------------------------ state

    private fun accessibilityEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val me = "$packageName/${GuardAccessibilityService::class.java.name}"
        return enabled.split(':').any { it.equals(me, true) || it.equals("$packageName/.GuardAccessibilityService", true) }
    }

    private fun notificationsAllowed(): Boolean =
        Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun batteryExempt(): Boolean =
        getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    private fun refresh() {
        store.pruneExpired()
        val a11y = accessibilityEnabled()
        val protected = a11y && store.hasPin && store.protectionEnabled
        findViewById<TextView>(R.id.statusText).apply {
            setText(if (protected) R.string.status_protected else R.string.status_unprotected)
            setTextColor(getColor(if (protected) R.color.ok else R.color.danger))
        }
        findViewById<TextView>(R.id.approverText).text = getString(R.string.approver_line, store.approverEmail)
        findViewById<TextView>(R.id.lastCheckText).text = getString(
            R.string.mail_last_check,
            if (store.lastPollTime == 0L) getString(R.string.mail_never)
            else MailPoller.fmt(store.lastPollTime) + (store.lastPollResult.takeIf { it.isNotBlank() }?.let { " – $it" } ?: ""),
        )

        val setup = findViewById<LinearLayout>(R.id.setupList)
        setup.removeAllViews()
        addSetup(setup, getString(R.string.setup_pin), store.hasPin, null) { PinDialog.create(this) { refresh() } }
        addSetup(setup, getString(R.string.setup_accessibility), a11y, getString(R.string.setup_accessibility_hint)) {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        addSetup(setup, getString(R.string.setup_admin), GuardDeviceAdminReceiver.isAdminActive(this), null) {
            startActivity(GuardDeviceAdminReceiver.requestActivation(this))
        }
        addSetup(setup, getString(R.string.setup_mail), store.mailConfig.isConfigured, null) {
            PinDialog.verify(this) { startActivity(Intent(this, SettingsActivity::class.java)) }
        }
        addSetup(setup, getString(R.string.setup_notifications), notificationsAllowed(), null) {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }
        addSetup(setup, getString(R.string.setup_battery), batteryExempt(), null) {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }
        addSetup(setup, getString(R.string.setup_overlay), Settings.canDrawOverlays(this), null) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        val allDone = store.hasPin && a11y && GuardDeviceAdminReceiver.isAdminActive(this) && store.mailConfig.isConfigured &&
            notificationsAllowed() && batteryExempt() && Settings.canDrawOverlays(this)
        findViewById<View>(R.id.setupCard).visibility = if (allDone) View.GONE else View.VISIBLE

        val approvals = findViewById<LinearLayout>(R.id.approvalsList)
        approvals.removeAllViews()
        val active = store.activeApprovals()
        if (active.isEmpty()) addEmpty(approvals, R.string.approvals_empty)
        for (ap in active) {
            addItem(approvals, ap.target, ap.label, getString(R.string.approval_expires, MailPoller.fmtDateTime(ap.expiresAt)) + " · " + remaining(ap.remainingMs), "Revoke") {
                PinDialog.verify(this) { policy.revoke(ap.target); MailPoller.notifyChanged(this); refresh() }
            }
        }

        val pending = findViewById<LinearLayout>(R.id.pendingList)
        pending.removeAllViews()
        val reqs = store.pendingRequests()
        if (reqs.isEmpty()) addEmpty(pending, R.string.pending_empty)
        for (r in reqs) {
            addItem(pending, r.target, r.label, "Code ${r.code} · sent ${MailPoller.fmtDateTime(r.createdAt)}", "Approve") {
                PinDialog.verify(this) {
                    policy.grant(r.target, store.defaultMinutes, "admin"); MailPoller.notifyChanged(this); refresh()
                }
            }
        }
    }

    private fun remaining(ms: Long): String {
        val m = (ms / 60_000).toInt()
        return if (m >= 60) "${m / 60}h ${m % 60}m left" else "${maxOf(m, 1)} min left"
    }

    private fun addSetup(parent: LinearLayout, title: String, done: Boolean, hint: String?, onOpen: () -> Unit) {
        val v = LayoutInflater.from(this).inflate(R.layout.item_setup, parent, false)
        v.findViewById<TextView>(R.id.setupState).apply {
            text = if (done) "✓" else "○"
            setTextColor(getColor(if (done) R.color.ok else R.color.warn))
        }
        v.findViewById<TextView>(R.id.setupTitle).text = title
        v.findViewById<TextView>(R.id.setupHint).apply {
            if (hint != null && !done) { text = hint; visibility = View.VISIBLE }
        }
        v.findViewById<Button>(R.id.setupButton).apply {
            setText(if (done) R.string.btn_done else R.string.btn_open)
            isEnabled = !done
            setOnClickListener { runCatching { onOpen() }.onFailure { Toast.makeText(context, it.message, Toast.LENGTH_SHORT).show() } }
        }
        parent.addView(v)
    }

    private fun addEmpty(parent: LinearLayout, res: Int) {
        val t = TextView(this)
        t.setText(res); t.setTextColor(getColor(R.color.text_secondary)); t.textSize = 13f
        parent.addView(t)
    }

    private fun addItem(parent: LinearLayout, target: Target, title: String, subtitle: String, action: String, onAction: () -> Unit) {
        val v = LayoutInflater.from(this).inflate(R.layout.item_approval, parent, false)
        val icon = v.findViewById<ImageView>(R.id.itemIcon)
        if (target.kind == Kind.APP) icon.setImageDrawable(Apps.icon(this, target.id) ?: getDrawable(R.drawable.ic_shield))
        else icon.setImageDrawable(getDrawable(R.drawable.ic_shield))
        v.findViewById<TextView>(R.id.itemTitle).text = title
        v.findViewById<TextView>(R.id.itemSubtitle).text = subtitle
        v.findViewById<Button>(R.id.itemAction).apply { text = action; setOnClickListener { onAction() } }
        parent.addView(v)
    }
}
