package com.hishamsiam.appguard

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/** Kind of thing an approval applies to. */
enum class Kind { APP, WEB }

/** A thing that can be approved: an app (package name) or a website (domain). */
data class Target(val kind: Kind, val id: String) {
    val key: String get() = "${kind.name.lowercase()}:$id"

    companion object {
        fun app(pkg: String) = Target(Kind.APP, pkg.trim())
        fun web(host: String) = Target(Kind.WEB, Domains.normalize(host))
        fun fromKey(key: String): Target? {
            val i = key.indexOf(':')
            if (i <= 0) return null
            return when (key.substring(0, i)) {
                "app" -> app(key.substring(i + 1))
                "web" -> web(key.substring(i + 1))
                else -> null
            }
        }
    }
}

data class Approval(val target: Target, val label: String, val grantedAt: Long, val expiresAt: Long, val source: String) {
    val remainingMs: Long get() = expiresAt - System.currentTimeMillis()
    val isActive: Boolean get() = remainingMs > 0
}

data class PendingRequest(val code: String, val target: Target, val label: String, val createdAt: Long)

data class MailConfig(
    val user: String,
    val password: String,
    val imapHost: String,
    val imapPort: Int,
    val smtpHost: String,
    val smtpPort: Int,
    val smtpSsl: Boolean,
) {
    val isConfigured: Boolean
        get() = user.isNotBlank() && password.isNotBlank() && imapHost.isNotBlank() && smtpHost.isNotBlank()
}

/**
 * All persistent state, backed by SharedPreferences. Small enough that JSON
 * blobs are simpler and more robust than a database here.
 */
class Store(context: Context) {
    private val sp: SharedPreferences =
        context.applicationContext.getSharedPreferences("appguard", Context.MODE_PRIVATE)

    companion object {
        const val DEFAULT_APPROVER = "hisham.siam@gmail.com"
        const val DEFAULT_MINUTES = 60
        const val DEFAULT_POLL_MINUTES = 5
        const val PENDING_TTL_MS = 24L * 60 * 60 * 1000
        private const val MAX_PROCESSED_IDS = 400

        @Volatile private var instance: Store? = null
        fun get(context: Context): Store =
            instance ?: synchronized(this) { instance ?: Store(context).also { instance = it } }
    }

    // ---------------------------------------------------------------- settings

    var protectionEnabled: Boolean
        get() = sp.getBoolean("protection_enabled", true)
        set(v) = sp.edit().putBoolean("protection_enabled", v).apply()

    var defaultMinutes: Int
        get() = sp.getInt("default_minutes", DEFAULT_MINUTES)
        set(v) = sp.edit().putInt("default_minutes", v.coerceIn(1, 7 * 24 * 60)).apply()

    var approverEmail: String
        get() = sp.getString("approver", DEFAULT_APPROVER)!!.trim().lowercase()
        set(v) = sp.edit().putString("approver", v.trim().lowercase()).apply()

    var pollMinutes: Int
        get() = sp.getInt("poll_minutes", DEFAULT_POLL_MINUTES)
        set(v) = sp.edit().putInt("poll_minutes", v.coerceIn(1, 240)).apply()

    var strictAuth: Boolean
        get() = sp.getBoolean("strict_auth", true)
        set(v) = sp.edit().putBoolean("strict_auth", v).apply()

    var browsersAllowed: Boolean
        get() = sp.getBoolean("browsers_allowed", true)
        set(v) = sp.edit().putBoolean("browsers_allowed", v).apply()

    var alwaysAllowedPackages: Set<String>
        get() = sp.getStringSet("allowed_pkgs", emptySet())!!.toSet()
        set(v) = sp.edit().putStringSet("allowed_pkgs", v.toSet()).apply()

    val installTime: Long
        get() {
            val t = sp.getLong("install_time", 0L)
            if (t != 0L) return t
            val now = System.currentTimeMillis()
            sp.edit().putLong("install_time", now).apply()
            return now
        }

    var lastPollTime: Long
        get() = sp.getLong("last_poll", 0L)
        set(v) = sp.edit().putLong("last_poll", v).apply()

    var lastPollResult: String
        get() = sp.getString("last_poll_result", "") ?: ""
        set(v) = sp.edit().putString("last_poll_result", v).apply()

    var mailConfig: MailConfig
        get() = MailConfig(
            user = sp.getString("mail_user", "") ?: "",
            password = sp.getString("mail_pass", "") ?: "",
            imapHost = sp.getString("imap_host", "") ?: "",
            imapPort = sp.getInt("imap_port", 993),
            smtpHost = sp.getString("smtp_host", "") ?: "",
            smtpPort = sp.getInt("smtp_port", 465),
            smtpSsl = sp.getBoolean("smtp_ssl", true),
        )
        set(c) = sp.edit()
            .putString("mail_user", c.user.trim())
            .putString("mail_pass", c.password)
            .putString("imap_host", c.imapHost.trim())
            .putInt("imap_port", c.imapPort)
            .putString("smtp_host", c.smtpHost.trim())
            .putInt("smtp_port", c.smtpPort)
            .putBoolean("smtp_ssl", c.smtpSsl)
            .apply()

    // --------------------------------------------------------------------- PIN

    val hasPin: Boolean get() = sp.contains("pin_hash")

    fun setPin(pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        sp.edit()
            .putString("pin_salt", salt.toHex())
            .putString("pin_hash", hashPin(pin, salt.toHex()))
            .apply()
    }

    fun checkPin(pin: String): Boolean {
        val salt = sp.getString("pin_salt", null) ?: return false
        val hash = sp.getString("pin_hash", null) ?: return false
        return hashPin(pin, salt) == hash
    }

    private fun hashPin(pin: String, saltHex: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        var digest = md.digest((saltHex + ":" + pin).toByteArray())
        repeat(5000) { digest = md.digest(digest + saltHex.toByteArray()) }
        return digest.toHex()
    }

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }

    // --------------------------------------------------------------- approvals

    @Synchronized
    fun approvals(): List<Approval> {
        val obj = JSONObject(sp.getString("approvals", "{}") ?: "{}")
        val out = ArrayList<Approval>()
        val it = obj.keys()
        while (it.hasNext()) {
            val key = it.next()
            val t = Target.fromKey(key) ?: continue
            val o = obj.getJSONObject(key)
            out.add(Approval(t, o.optString("label", t.id), o.optLong("grantedAt"), o.optLong("expiresAt"), o.optString("source")))
        }
        return out.sortedBy { it.expiresAt }
    }

    fun activeApprovals(): List<Approval> = approvals().filter { it.isActive }

    fun approvalFor(target: Target): Approval? = approvals().firstOrNull { it.target == target }

    @Synchronized
    fun putApproval(a: Approval) {
        val obj = JSONObject(sp.getString("approvals", "{}") ?: "{}")
        obj.put(a.target.key, JSONObject().apply {
            put("label", a.label); put("grantedAt", a.grantedAt); put("expiresAt", a.expiresAt); put("source", a.source)
        })
        sp.edit().putString("approvals", obj.toString()).apply()
    }

    @Synchronized
    fun removeApproval(target: Target) {
        val obj = JSONObject(sp.getString("approvals", "{}") ?: "{}")
        obj.remove(target.key)
        sp.edit().putString("approvals", obj.toString()).apply()
    }

    @Synchronized
    fun clearApprovals() = sp.edit().putString("approvals", "{}").apply()

    /** Drops expired entries; returns the ones that were removed. */
    @Synchronized
    fun pruneExpired(): List<Approval> {
        val expired = approvals().filter { !it.isActive }
        expired.forEach { removeApproval(it.target) }
        return expired
    }

    // ----------------------------------------------------------------- pending

    @Synchronized
    fun pendingRequests(): List<PendingRequest> {
        val obj = JSONObject(sp.getString("pending", "{}") ?: "{}")
        val out = ArrayList<PendingRequest>()
        val now = System.currentTimeMillis()
        var changed = false
        val it = obj.keys()
        val stale = ArrayList<String>()
        while (it.hasNext()) {
            val code = it.next()
            val o = obj.getJSONObject(code)
            val created = o.optLong("createdAt")
            if (now - created > PENDING_TTL_MS) { stale.add(code); continue }
            val t = Target.fromKey(o.optString("target")) ?: continue
            out.add(PendingRequest(code, t, o.optString("label", t.id), created))
        }
        for (s in stale) { obj.remove(s); changed = true }
        if (changed) sp.edit().putString("pending", obj.toString()).apply()
        return out.sortedByDescending { it.createdAt }
    }

    fun pendingFor(target: Target): PendingRequest? = pendingRequests().firstOrNull { it.target == target }
    fun pendingByCode(code: String): PendingRequest? = pendingRequests().firstOrNull { it.code.equals(code, true) }

    @Synchronized
    fun putPending(p: PendingRequest) {
        val obj = JSONObject(sp.getString("pending", "{}") ?: "{}")
        obj.put(p.code, JSONObject().apply {
            put("target", p.target.key); put("label", p.label); put("createdAt", p.createdAt)
        })
        sp.edit().putString("pending", obj.toString()).apply()
    }

    @Synchronized
    fun removePending(code: String) {
        val obj = JSONObject(sp.getString("pending", "{}") ?: "{}")
        obj.remove(code)
        sp.edit().putString("pending", obj.toString()).apply()
    }

    @Synchronized
    fun removePendingFor(target: Target) {
        pendingRequests().filter { it.target == target }.forEach { removePending(it.code) }
    }

    // ------------------------------------------------------ processed messages

    @Synchronized
    fun isProcessed(messageId: String): Boolean {
        val arr = JSONArray(sp.getString("processed_ids", "[]") ?: "[]")
        for (i in 0 until arr.length()) if (arr.getString(i) == messageId) return true
        return false
    }

    @Synchronized
    fun markProcessed(messageId: String) {
        val arr = JSONArray(sp.getString("processed_ids", "[]") ?: "[]")
        arr.put(messageId)
        val trimmed = if (arr.length() > MAX_PROCESSED_IDS) {
            JSONArray().also { n -> for (i in arr.length() - MAX_PROCESSED_IDS until arr.length()) n.put(arr.getString(i)) }
        } else arr
        sp.edit().putString("processed_ids", trimmed.toString()).apply()
    }

    fun newRequestCode(): String {
        val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I
        val rnd = SecureRandom()
        while (true) {
            val code = (1..6).map { alphabet[rnd.nextInt(alphabet.length)] }.joinToString("")
            if (pendingByCode(code) == null) return code
        }
    }
}

/** Domain helpers shared by the blocker and the approval parser. */
object Domains {
    fun normalize(input: String): String {
        var s = input.trim().lowercase()
        s = s.removePrefix("http://").removePrefix("https://")
        s = s.substringBefore('/').substringBefore('?').substringBefore('#')
        s = s.substringBefore(':')
        s = s.removePrefix("www.").trimEnd('.')
        return s
    }

    /** True when [host] is [domain] itself or a subdomain of it. */
    fun matches(host: String, domain: String): Boolean {
        val h = normalize(host); val d = normalize(domain)
        if (d.isEmpty()) return false
        return h == d || h.endsWith(".$d")
    }

    private val hostRegex = Regex("^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$")
    private val ipRegex = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

    fun looksLikeHost(s: String): Boolean {
        val n = normalize(s)
        return n.isNotEmpty() && !n.contains(' ') && (hostRegex.matches(n) || ipRegex.matches(n) || n == "localhost")
    }
}
