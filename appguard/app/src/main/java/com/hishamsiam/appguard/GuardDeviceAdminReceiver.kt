package com.hishamsiam.appguard

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.UserManager

/**
 * Device administrator: while active, Android refuses to uninstall the app
 * until the admin is deactivated, and deactivation shows our warning. When
 * the app has additionally been made device owner (adb `dpm set-device-owner`)
 * [harden] locks down the escape hatches too.
 */
class GuardDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
        context.getString(R.string.device_admin_disable_warning)

    override fun onEnabled(context: Context, intent: Intent) {
        harden(context)
    }

    companion object {
        fun component(ctx: Context) = ComponentName(ctx, GuardDeviceAdminReceiver::class.java)

        fun isAdminActive(ctx: Context): Boolean =
            ctx.getSystemService(DevicePolicyManager::class.java).isAdminActive(component(ctx))

        fun isDeviceOwner(ctx: Context): Boolean =
            ctx.getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(ctx.packageName)

        fun requestActivation(ctx: Context): Intent =
            Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component(ctx))
                .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, ctx.getString(R.string.device_admin_description))

        fun deactivate(ctx: Context) {
            val dpm = ctx.getSystemService(DevicePolicyManager::class.java)
            if (isDeviceOwner(ctx)) {
                val c = component(ctx)
                runCatching { dpm.setUninstallBlocked(c, ctx.packageName, false) }
                for (r in RESTRICTIONS) runCatching { dpm.clearUserRestriction(c, r) }
            }
            runCatching { dpm.removeActiveAdmin(component(ctx)) }
        }

        private val RESTRICTIONS = listOf(
            UserManager.DISALLOW_FACTORY_RESET,
            UserManager.DISALLOW_SAFE_BOOT,
            UserManager.DISALLOW_ADD_USER,
            UserManager.DISALLOW_DEBUGGING_FEATURES,
            UserManager.DISALLOW_APPS_CONTROL,
            UserManager.DISALLOW_UNINSTALL_APPS,
        )

        /** Returns a description of what was applied, or null when not device owner. */
        fun harden(ctx: Context): String? {
            if (!isDeviceOwner(ctx)) return null
            val dpm = ctx.getSystemService(DevicePolicyManager::class.java)
            val c = component(ctx)
            val done = ArrayList<String>()
            runCatching { dpm.setUninstallBlocked(c, ctx.packageName, true); done.add("uninstall blocked") }
            for (r in RESTRICTIONS) runCatching { dpm.addUserRestriction(c, r); done.add(r.removePrefix("no_")) }
            return done.joinToString(", ")
        }
    }
}
