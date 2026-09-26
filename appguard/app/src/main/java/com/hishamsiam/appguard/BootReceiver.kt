package com.hishamsiam.appguard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        MailPollJob.schedule(context)
        Store.get(context).pruneExpired()
    }
}
