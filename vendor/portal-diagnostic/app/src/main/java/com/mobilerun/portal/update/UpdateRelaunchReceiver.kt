package com.mobilerun.portal.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.mobilerun.portal.BuildConfig

class UpdateRelaunchReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!BuildConfig.UPDATES_ENABLED) return
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!UpdateChecker.consumeRelaunchAfterUpdate(context)) return

        val pendingResult = goAsync()
        Handler(Looper.getMainLooper()).postDelayed(
            {
                try {
                    launchPortal(context)
                } finally {
                    pendingResult.finish()
                }
            },
            RELAUNCH_DELAY_MS,
        )
    }

    companion object {
        private const val TAG = "UpdateRelaunchReceiver"
        private const val RELAUNCH_DELAY_MS = 750L

        fun launchPortal(context: Context) {
            if (!BuildConfig.UPDATES_ENABLED) return
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (launchIntent == null) {
                Log.w(TAG, "Cannot relaunch portal after update: launch intent missing")
                return
            }

            launchIntent
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)

            try {
                context.startActivity(launchIntent)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to relaunch portal after update", e)
            }
        }
    }
}
