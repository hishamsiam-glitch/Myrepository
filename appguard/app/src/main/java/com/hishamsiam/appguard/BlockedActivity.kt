package com.hishamsiam.appguard

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast

/** Full-screen "blocked" page shown over any app or website that is not approved. */
class BlockedActivity : Activity() {

    companion object {
        const val EXTRA_KIND = "kind"
        const val EXTRA_ID = "id"
        const val EXTRA_SOURCE_PKG = "source"
        private const val AUTO_CHECK_MS = 45_000L
    }

    private lateinit var store: Store
    private lateinit var policy: Policy
    private lateinit var target: Target
    private var sourcePkg: String? = null
    private val handler = Handler(Looper.getMainLooper())

    private val changeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { closeIfAllowed(); render() }
    }

    private val autoCheck = object : Runnable {
        override fun run() {
            if (store.pendingFor(target) != null && store.mailConfig.isConfigured) {
                MailPoller.pollNow(this@BlockedActivity) { closeIfAllowed(); render() }
            }
            handler.postDelayed(this, AUTO_CHECK_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_blocked)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        store = Store.get(this)
        policy = Policy(this)
        readIntent(intent)

        findViewById<Button>(R.id.btnRequest).setOnClickListener { sendRequest() }
        findViewById<Button>(R.id.btnCheck).setOnClickListener { v ->
            v.isEnabled = false
            MailPoller.pollNow(this) { msg -> v.isEnabled = true; status(msg); closeIfAllowed(); render() }
        }
        findViewById<Button>(R.id.btnHome).setOnClickListener { goHome() }
        findViewById<Button>(R.id.btnBack).setOnClickListener {
            val svc = GuardAccessibilityService.instance
            if (svc != null) { finish(); handler.postDelayed({ svc.goBack() }, 150) } else goHome()
        }
        findViewById<Button>(R.id.btnAdminUnlock).setOnClickListener {
            PinDialog.verify(this) {
                policy.grant(target, store.defaultMinutes, "admin")
                MailPoller.notifyChanged(this)
                Toast.makeText(this, getString(R.string.notif_approved, policy.labelFor(target), MailPoller.fmt(System.currentTimeMillis() + store.defaultMinutes * 60_000L)), Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readIntent(intent)
        render()
    }

    private fun readIntent(i: Intent) {
        val kind = runCatching { Kind.valueOf(i.getStringExtra(EXTRA_KIND) ?: "APP") }.getOrDefault(Kind.APP)
        val id = i.getStringExtra(EXTRA_ID) ?: packageName
        target = if (kind == Kind.APP) Target.app(id) else Target.web(id)
        sourcePkg = i.getStringExtra(EXTRA_SOURCE_PKG)
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter(MailPoller.ACTION_POLICY_CHANGED)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(changeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(changeReceiver, filter)
        handler.postDelayed(autoCheck, AUTO_CHECK_MS)
        closeIfAllowed()
        render()
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(autoCheck)
        runCatching { unregisterReceiver(changeReceiver) }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { goHome() }

    private fun goHome() {
        finish()
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun isAllowedNow(): Boolean = when (target.kind) {
        Kind.APP -> policy.isAppAllowed(target.id)
        Kind.WEB -> policy.isHostAllowed(target.id)
    }

    private fun closeIfAllowed() {
        if (isAllowedNow()) finish()
    }

    private fun render() {
        val icon = findViewById<ImageView>(R.id.targetIcon)
        val name = findViewById<TextView>(R.id.targetName)
        val idView = findViewById<TextView>(R.id.targetId)
        val message = findViewById<TextView>(R.id.message)
        if (target.kind == Kind.APP) {
            icon.setImageDrawable(Apps.icon(this, target.id) ?: getDrawable(R.drawable.ic_shield))
            name.text = Apps.label(this, target.id)
            idView.text = target.id
            message.setText(if (policy.hasExpired(target)) R.string.blocked_expired_msg else R.string.blocked_app_msg)
        } else {
            icon.setImageDrawable(getDrawable(R.drawable.ic_shield))
            name.text = target.id
            idView.text = sourcePkg?.let { Apps.label(this, it) } ?: ""
            message.setText(if (policy.hasExpired(target)) R.string.blocked_expired_msg else R.string.blocked_web_msg)
        }

        val pending = store.pendingFor(target)
        val codeBox = findViewById<View>(R.id.codeBox)
        val btnRequest = findViewById<Button>(R.id.btnRequest)
        if (pending != null) {
            codeBox.visibility = View.VISIBLE
            findViewById<TextView>(R.id.codeText).text = pending.code
            btnRequest.setText(R.string.btn_requested)
            btnRequest.isEnabled = false
            status(getString(R.string.request_sent_to, store.approverEmail))
        } else {
            codeBox.visibility = View.GONE
            btnRequest.setText(R.string.btn_request)
            btnRequest.isEnabled = true
            if (!store.mailConfig.isConfigured) status(getString(R.string.request_no_mail)) else status("")
        }
        findViewById<View>(R.id.btnCheck).visibility = if (store.mailConfig.isConfigured) View.VISIBLE else View.GONE
        findViewById<View>(R.id.btnBack).visibility = if (target.kind == Kind.WEB) View.VISIBLE else View.GONE
    }

    private fun sendRequest() {
        val btn = findViewById<Button>(R.id.btnRequest)
        btn.isEnabled = false
        status("Sending request…")
        MailPoller.requestApproval(this, target) { result ->
            result.onSuccess { render() }
                .onFailure { e ->
                    btn.isEnabled = true
                    status(getString(R.string.request_failed, e.message ?: e.javaClass.simpleName))
                }
        }
    }

    private fun status(text: String) {
        findViewById<TextView>(R.id.statusText).text = text
    }
}
