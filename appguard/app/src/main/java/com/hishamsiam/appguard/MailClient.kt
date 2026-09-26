package com.hishamsiam.appguard

import java.util.Date
import java.util.Properties
import javax.mail.Authenticator
import javax.mail.Folder
import javax.mail.Message
import javax.mail.Multipart
import javax.mail.Part
import javax.mail.PasswordAuthentication
import javax.mail.Session
import javax.mail.Transport
import javax.mail.internet.InternetAddress
import javax.mail.internet.MimeMessage
import javax.mail.internet.MimeUtility
import javax.mail.search.AndTerm
import javax.mail.search.ComparisonTerm
import javax.mail.search.FromStringTerm
import javax.mail.search.ReceivedDateTerm

/** A message pulled from the inbox, reduced to what the approval logic needs. */
data class InboundMail(
    val messageId: String,
    val from: String,
    val subject: String,
    val body: String,
    val date: Long,
    val authResults: List<String>,
    val isOwnRequest: Boolean,
)

/** Thin JavaMail wrapper: one SMTP send, one IMAP fetch, one connection test. */
class MailClient(private val cfg: MailConfig) {

    companion object {
        const val HEADER_REQUEST = "X-AppGuard-Request"
        const val SUBJECT_PREFIX = "[AppGuard] Approval request"
        private const val TIMEOUT = "20000"
    }

    private fun session(): Session {
        val p = Properties()
        // IMAP
        p["mail.store.protocol"] = "imaps"
        p["mail.imaps.host"] = cfg.imapHost
        p["mail.imaps.port"] = cfg.imapPort.toString()
        p["mail.imaps.ssl.enable"] = "true"
        p["mail.imaps.connectiontimeout"] = TIMEOUT
        p["mail.imaps.timeout"] = TIMEOUT
        p["mail.imaps.partialfetch"] = "false"
        // SMTP
        p["mail.smtp.host"] = cfg.smtpHost
        p["mail.smtp.port"] = cfg.smtpPort.toString()
        p["mail.smtp.auth"] = "true"
        p["mail.smtp.connectiontimeout"] = TIMEOUT
        p["mail.smtp.timeout"] = TIMEOUT
        p["mail.smtp.writetimeout"] = TIMEOUT
        if (cfg.smtpSsl) {
            p["mail.smtp.ssl.enable"] = "true"
            p["mail.smtp.socketFactory.port"] = cfg.smtpPort.toString()
        } else {
            p["mail.smtp.starttls.enable"] = "true"
            p["mail.smtp.starttls.required"] = "true"
        }
        return Session.getInstance(p, object : Authenticator() {
            override fun getPasswordAuthentication() = PasswordAuthentication(cfg.user, cfg.password)
        })
    }

    fun sendRequest(to: String, request: PendingRequest, defaultMinutes: Int, deviceName: String) {
        val kindWord = if (request.target.kind == Kind.APP) "app" else "website"
        val subject = "$SUBJECT_PREFIX ${request.code}: ${request.label}"
        val body = buildString {
            appendLine("AppGuard on \"$deviceName\" is asking for permission to use the $kindWord:")
            appendLine()
            appendLine("    ${request.label}")
            if (request.label != request.target.id) appendLine("    (${request.target.id})")
            appendLine()
            appendLine("Request code: ${request.code}")
            appendLine()
            appendLine("Reply to this email with one of these on the first line:")
            appendLine("  APPROVE        - allow for the default $defaultMinutes minutes")
            appendLine("  APPROVE 45     - allow for 45 minutes (any number works, e.g. 2h)")
            appendLine("  DENY           - reject the request")
            appendLine()
            appendLine("The device checks the mailbox every few minutes; the block screen")
            appendLine("closes by itself once your approval arrives.")
        }
        val msg = MimeMessage(session())
        msg.setFrom(InternetAddress(cfg.user))
        msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to))
        msg.subject = subject
        msg.setText(body, "utf-8")
        msg.setHeader(HEADER_REQUEST, request.code)
        msg.sentDate = Date()
        Transport.send(msg)
    }

    /** Everything from [approver] received since [sinceMillis] (day granularity on the server, exact locally). */
    fun fetchFrom(approver: String, sinceMillis: Long): List<InboundMail> {
        val out = ArrayList<InboundMail>()
        val store = session().getStore("imaps")
        store.connect(cfg.imapHost, cfg.imapPort, cfg.user, cfg.password)
        try {
            val inbox = store.getFolder("INBOX")
            inbox.open(Folder.READ_ONLY)
            try {
                val since = Date(sinceMillis - 24L * 60 * 60 * 1000)
                val term = AndTerm(FromStringTerm(approver), ReceivedDateTerm(ComparisonTerm.GE, since))
                val found = try { inbox.search(term) } catch (_: Exception) {
                    // Some servers reject SEARCH; fall back to the newest 50 messages.
                    val n = inbox.messageCount
                    inbox.getMessages(maxOf(1, n - 49), n)
                }
                for (m in found) {
                    val date = (m.receivedDate ?: m.sentDate)?.time ?: continue
                    if (date < sinceMillis) continue
                    val from = (m.from?.firstOrNull() as? InternetAddress)?.address?.lowercase() ?: continue
                    if (from != approver.lowercase()) continue
                    val id = m.getHeader("Message-ID")?.firstOrNull()?.trim() ?: "${from}:${date}:${m.subject}"
                    val auth = (m.getHeader("Authentication-Results") ?: emptyArray()).map { MimeUtility.unfold(it) }
                    val own = m.getHeader(HEADER_REQUEST) != null
                    out.add(InboundMail(id, from, m.subject ?: "", extractText(m), date, auth, own))
                }
            } finally { inbox.close(false) }
        } finally { store.close() }
        return out.sortedBy { it.date }
    }

    /** Connects to both servers; returns a human-readable summary or throws. */
    fun test(): String {
        val s = session()
        val store = s.getStore("imaps")
        store.connect(cfg.imapHost, cfg.imapPort, cfg.user, cfg.password)
        val count = try {
            val inbox = store.getFolder("INBOX"); inbox.open(Folder.READ_ONLY)
            val c = inbox.messageCount; inbox.close(false); c
        } finally { store.close() }
        val t = s.getTransport("smtp")
        t.connect(cfg.smtpHost, cfg.smtpPort, cfg.user, cfg.password)
        t.close()
        return "IMAP OK ($count messages in INBOX), SMTP OK"
    }

    private fun extractText(part: Part): String {
        return try {
            when {
                part.isMimeType("text/plain") -> (part.content as? String) ?: ""
                part.isMimeType("text/html") -> stripHtml((part.content as? String) ?: "")
                part.isMimeType("multipart/alternative") -> {
                    val mp = part.content as Multipart
                    var plain = ""; var html = ""
                    for (i in 0 until mp.count) {
                        val bp = mp.getBodyPart(i)
                        if (bp.isMimeType("text/plain") && plain.isEmpty()) plain = extractText(bp)
                        else if (bp.isMimeType("text/html") && html.isEmpty()) html = extractText(bp)
                        else if (plain.isEmpty()) plain = extractText(bp)
                    }
                    if (plain.isNotBlank()) plain else html
                }
                part.isMimeType("multipart/*") -> {
                    val mp = part.content as Multipart
                    val sb = StringBuilder()
                    for (i in 0 until mp.count) sb.append(extractText(mp.getBodyPart(i))).append('\n')
                    sb.toString()
                }
                else -> ""
            }
        } catch (_: Exception) { "" }
    }

    private fun stripHtml(html: String): String = Html.strip(html)
}
