package com.hishamsiam.appguard

/** Checks the receiving server's Authentication-Results headers for a message claiming to be from the approver. */
object SenderAuth {
    /**
     * Accepts a message only when the receiving server confirmed the sender's
     * domain (DKIM / SPF / DMARC). Gmail always adds these headers; a mailbox
     * at a provider that does not can switch strict mode off in settings.
     */
    fun passes(m: InboundMail, approver: String, strict: Boolean): Boolean {
        if (m.authResults.isEmpty()) return !strict
        val domain = Regex.escape(approver.substringAfter('@').lowercase())
        val patterns = listOf(
            Regex("dkim=pass[^;]*header\\.[id]=@?(?:[\\w.-]+\\.)?$domain\\b", RegexOption.IGNORE_CASE),
            Regex("dmarc=pass[^;]*header\\.from=(?:[\\w.-]+\\.)?$domain\\b", RegexOption.IGNORE_CASE),
            Regex("spf=pass[^;]*smtp\\.mailfrom=(?:[\\w.+-]+@)?(?:[\\w.-]+\\.)?$domain\\b", RegexOption.IGNORE_CASE),
        )
        return m.authResults.any { h -> patterns.any { it.containsMatchIn(h) } }
    }
}
