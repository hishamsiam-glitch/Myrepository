package com.hishamsiam.appguard

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Store.get(this).installTime // record first-run time
        Notifier.ensureChannel(this)
        MailPollJob.schedule(this)
    }
}
