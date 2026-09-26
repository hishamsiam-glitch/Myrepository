package com.hishamsiam.appguard

/** What the approver asked for in an email. */
data class Command(val action: Action, val code: String?, val targetText: String?, val minutes: Int?) {
    enum class Action { APPROVE, DENY, REVOKE, LOCK }
}

/**
 * Turns the subject + body of an email from the approver into a [Command].
 * Only the approver's own words count: quoted text and everything after a
 * reply separator is ignored, so the instructions AppGuard itself wrote into
 * the request can never be mistaken for an approval.
 */
object ApprovalParser {
    private val codeInSubject = Regex("request\\s+([A-Z0-9]{6})\\b", RegexOption.IGNORE_CASE)
    private val codeInBody = Regex("\\b(?:code|request)\\s*[:#]?\\s*([A-Z0-9]{6})\\b", RegexOption.IGNORE_CASE)
    private val replySeparators = listOf(
        Regex("^On .{4,120} wrote:\\s*$", RegexOption.IGNORE_CASE),
        Regex("^-{2,}\\s*Original Message\\s*-{2,}$", RegexOption.IGNORE_CASE),
        Regex("^From:\\s.+", RegexOption.IGNORE_CASE),
        Regex("^Sent from my .+", RegexOption.IGNORE_CASE),
        Regex("^_{5,}$"),
        Regex("^\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}.*<.+@.+>.*:\\s*$"),
        Regex("^.*AppGuard on \".*\" is asking.*$"),
    )
    private val commandRegex = Regex(
        "^\\W*(APPROVE|APPROVED|ALLOW|ALLOWED|OK|OKAY|YES|GRANT|DENY|DENIED|REJECT|REJECTED|NO|REVOKE|BLOCK|LOCK|LOCKDOWN)\\b\\s*[:\\-]?\\s*(.*)$",
        RegexOption.IGNORE_CASE,
    )
    private val durationRegex = Regex("^(\\d{1,5})\\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$", RegexOption.IGNORE_CASE)

    fun parse(subject: String, body: String): Command? {
        val cleanSubject = subject.replace(Regex("^(\\s*(re|fw|fwd|aw|wg)\\s*:\\s*)+", RegexOption.IGNORE_CASE), "").trim()
        val code = codeInSubject.find(cleanSubject)?.groupValues?.get(1)?.uppercase()
            ?: codeInBody.find(ownLines(body).joinToString("\n"))?.groupValues?.get(1)?.uppercase()

        val candidates = ArrayList<String>()
        if (!cleanSubject.startsWith("[AppGuard]", ignoreCase = true)) candidates.add(cleanSubject)
        candidates.addAll(ownLines(body))

        for (line in candidates) {
            val m = commandRegex.find(line.trim()) ?: continue
            val word = m.groupValues[1].uppercase()
            val rest = m.groupValues[2].trim()
            val action = when (word) {
                "APPROVE", "APPROVED", "ALLOW", "ALLOWED", "OK", "OKAY", "YES", "GRANT" -> Command.Action.APPROVE
                "DENY", "DENIED", "REJECT", "REJECTED", "NO" -> Command.Action.DENY
                "REVOKE", "BLOCK" -> Command.Action.REVOKE
                "LOCK", "LOCKDOWN" -> Command.Action.LOCK
                else -> continue
            }
            var minutes: Int? = null
            val targetWords = ArrayList<String>()
            val tokens = rest.split(Regex("\\s+")).filter { it.isNotBlank() }
            var i = 0
            while (i < tokens.size) {
                val tok = tokens[i].trim(',', ';', '.', '!', ')', '(')
                val dm = durationRegex.find(tok)
                if (tok.matches(Regex("\\d{1,5}")) && i + 1 < tokens.size && durationUnit(tokens[i + 1]) != null) {
                    minutes = toMinutes(tok.toInt(), tokens[i + 1]); i++
                } else if (dm != null) {
                    minutes = toMinutes(dm.groupValues[1].toInt(), dm.groupValues[2])
                } else if (tok.equals("for", true) || tok.equals("minutes", true) || tok.equals("mins", true)) {
                    // filler
                } else {
                    targetWords.add(tok)
                }
                i++
            }
            val targetText = targetWords.joinToString(" ").ifBlank { null }
            return Command(action, code, targetText, minutes)
        }
        return null
    }

    private fun durationUnit(s: String): String? =
        if (s.matches(Regex("(?i)(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)"))) s else null

    private fun toMinutes(n: Int, unit: String): Int = when (unit.lowercase().firstOrNull()) {
        'h' -> n * 60
        'd' -> n * 24 * 60
        else -> n
    }

    private val htmlHint = Regex("<(div|br|p|html|body|span|table)[\\s>/]", RegexOption.IGNORE_CASE)

    /** Lines the approver typed: stops at the first reply separator, skips quoted lines. */
    fun ownLines(body: String): List<String> {
        val text = if (htmlHint.containsMatchIn(body)) Html.strip(body) else body
        val out = ArrayList<String>()
        for (raw in text.replace("\r", "").split('\n')) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith(">")) continue
            if (replySeparators.any { it.matches(line) }) break
            out.add(line)
            if (out.size >= 12) break
        }
        return out
    }
}

/** Minimal HTML-to-text used for replies that arrive without a text/plain part. */
object Html {
    fun strip(html: String): String = html
        .replace(Regex("(?is)<(script|style)[^>]*>.*?</\\1>"), " ")
        .replace(Regex("(?i)<br\\s*/?>"), "\n")
        .replace(Regex("(?i)</(p|div|tr|li|h\\d)>"), "\n")
        .replace(Regex("(?is)<blockquote[^>]*>.*?</blockquote>"), "\n> quoted\n")
        .replace(Regex("<[^>]+>"), " ")
        .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&#39;", "'")
        .lines().joinToString("\n") { it.trim() }
}
