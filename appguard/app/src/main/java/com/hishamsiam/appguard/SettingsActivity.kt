package com.hishamsiam.appguard

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.view.MenuItem
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors

/** Administrator settings (reached only after the PIN check). */
class SettingsActivity : Activity() {

    private lateinit var store: Store
    private lateinit var policy: Policy
    private val io = Executors.newSingleThreadExecutor()

    private data class Preset(val name: String, val imap: String, val imapPort: Int, val smtp: String, val smtpPort: Int, val ssl: Boolean)
    private val presets = listOf(
        Preset("Custom", "", 993, "", 465, true),
        Preset("Gmail / Google Workspace", "imap.gmail.com", 993, "smtp.gmail.com", 465, true),
        Preset("Outlook / Hotmail / Office 365", "outlook.office365.com", 993, "smtp.office365.com", 587, false),
        Preset("Yahoo Mail", "imap.mail.yahoo.com", 993, "smtp.mail.yahoo.com", 465, true),
        Preset("iCloud Mail", "imap.mail.me.com", 993, "smtp.mail.me.com", 587, false),
        Preset("Zoho Mail", "imap.zoho.com", 993, "smtp.zoho.com", 465, true),
    )

    private fun et(id: Int) = findViewById<EditText>(id)
    private fun sw(id: Int) = findViewById<Switch>(id)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        store = Store.get(this)
        policy = Policy(this)
        actionBar?.setDisplayHomeAsUpEnabled(true)

        // General
        sw(R.id.swProtection).isChecked = store.protectionEnabled
        et(R.id.etDefaultMinutes).setText(store.defaultMinutes.toString())
        et(R.id.etApprover).setText(store.approverEmail)
        sw(R.id.swBrowsers).isChecked = store.browsersAllowed
        findViewById<Button>(R.id.btnAlwaysAllowed).setOnClickListener { startActivity(Intent(this, AppPickerActivity::class.java)) }

        // Mail
        val cfg = store.mailConfig
        et(R.id.etMailUser).setText(cfg.user)
        et(R.id.etMailPass).setText(cfg.password)
        et(R.id.etImapHost).setText(cfg.imapHost)
        et(R.id.etImapPort).setText(cfg.imapPort.toString())
        et(R.id.etSmtpHost).setText(cfg.smtpHost)
        et(R.id.etSmtpPort).setText(cfg.smtpPort.toString())
        sw(R.id.swSmtpSsl).isChecked = cfg.smtpSsl
        et(R.id.etPoll).setText(store.pollMinutes.toString())
        sw(R.id.swStrictAuth).isChecked = store.strictAuth

        val spinner = findViewById<Spinner>(R.id.spPreset)
        spinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, presets.map { it.name })
        spinner.setSelection(presets.indexOfFirst { it.imap.isNotEmpty() && it.imap == cfg.imapHost }.coerceAtLeast(0), false)
        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val p = presets[position]
                if (p.imap.isEmpty()) return
                et(R.id.etImapHost).setText(p.imap); et(R.id.etImapPort).setText(p.imapPort.toString())
                et(R.id.etSmtpHost).setText(p.smtp); et(R.id.etSmtpPort).setText(p.smtpPort.toString())
                sw(R.id.swSmtpSsl).isChecked = p.ssl
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        findViewById<Button>(R.id.btnTestMail).setOnClickListener { v ->
            save(silent = true)
            val result = findViewById<TextView>(R.id.tvMailResult)
            result.text = "Connecting…"; v.isEnabled = false
            val c = store.mailConfig
            io.execute {
                val msg = runCatching { MailClient(c).test() }.getOrElse { "Failed: ${it.message ?: it.javaClass.simpleName}" }
                runOnUiThread { result.text = msg; v.isEnabled = true }
            }
        }

        // Manual control
        et(R.id.etManualMinutes).setText(store.defaultMinutes.toString())
        findViewById<Button>(R.id.btnGrant).setOnClickListener {
            val text = et(R.id.etManualTarget).text.toString()
            val target = policy.resolveTarget(text)
            if (target == null) { toast("Could not understand \"$text\" – use a package name, an app name or a website"); return@setOnClickListener }
            val minutes = et(R.id.etManualMinutes).text.toString().toIntOrNull() ?: store.defaultMinutes
            val a = policy.grant(target, minutes, "admin")
            MailPoller.notifyChanged(this)
            toast(getString(R.string.notif_approved, a.label, MailPoller.fmt(a.expiresAt)))
            et(R.id.etManualTarget).text.clear()
        }
        findViewById<Button>(R.id.btnRevokeAll).setOnClickListener {
            policy.revokeAll(); MailPoller.notifyChanged(this); toast("All approvals revoked")
        }

        // Security
        findViewById<Button>(R.id.btnChangePin).setOnClickListener { PinDialog.create(this) { toast("PIN updated") } }
        findViewById<Button>(R.id.btnHarden).setOnClickListener {
            val r = GuardDeviceAdminReceiver.harden(this)
            toast(r?.let { "Applied: $it" } ?: "AppGuard is not device owner on this device")
        }
        findViewById<Button>(R.id.btnDisableAdmin).setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle(R.string.s_disable_admin)
                .setMessage(R.string.device_admin_disable_warning)
                .setPositiveButton(R.string.ok) { _, _ -> GuardDeviceAdminReceiver.deactivate(this); toast("Device administrator deactivated") }
                .setNegativeButton(R.string.cancel, null)
                .show()
        }

        findViewById<Button>(R.id.btnSave).setOnClickListener { save(silent = false); finish() }
    }

    override fun onNavigateUp(): Boolean { save(silent = true); finish(); return true }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == android.R.id.home) { save(silent = true); finish(); return true }
        return super.onOptionsItemSelected(item)
    }

    override fun onPause() {
        super.onPause()
        save(silent = true)
    }

    private fun save(silent: Boolean) {
        store.protectionEnabled = sw(R.id.swProtection).isChecked
        store.defaultMinutes = et(R.id.etDefaultMinutes).text.toString().toIntOrNull() ?: Store.DEFAULT_MINUTES
        val approver = et(R.id.etApprover).text.toString().trim()
        if (approver.contains('@')) store.approverEmail = approver
        store.browsersAllowed = sw(R.id.swBrowsers).isChecked
        store.mailConfig = MailConfig(
            user = et(R.id.etMailUser).text.toString(),
            password = et(R.id.etMailPass).text.toString(),
            imapHost = et(R.id.etImapHost).text.toString(),
            imapPort = et(R.id.etImapPort).text.toString().toIntOrNull() ?: 993,
            smtpHost = et(R.id.etSmtpHost).text.toString(),
            smtpPort = et(R.id.etSmtpPort).text.toString().toIntOrNull() ?: 465,
            smtpSsl = sw(R.id.swSmtpSsl).isChecked,
        )
        store.pollMinutes = et(R.id.etPoll).text.toString().toIntOrNull() ?: Store.DEFAULT_POLL_MINUTES
        store.strictAuth = sw(R.id.swStrictAuth).isChecked
        MailPoller.notifyChanged(this)
        if (!silent) toast(getString(R.string.s_saved))
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()
}
