package com.mobilerun.portal.update

import android.content.Context
import android.content.Intent
import com.mobilerun.portal.BuildConfig
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Debug-only: disabled updater entry points must return before touching Android or the network. */
class DiagnosticUpdateIsolationTest {
    @Test
    fun checksRejectWithoutReadingContext() {
        val context = mockk<Context>()
        val results = mutableListOf<UpdateCheckResult>()
        UpdateChecker.checkOnStartupIfNeeded(context, results::add)
        UpdateChecker.checkForUpdate(context, results::add)
        assertEquals(2, results.size)
        assertTrue(results.all { it is UpdateCheckResult.Failed && it.message.contains("disabled") })
        verify(exactly = 0) { context.getSharedPreferences(any(), any()) }
        verify(exactly = 0) { context.packageManager }
    }

    @Test
    fun cachedAndDownloadPathsAreDisabled() {
        val context = mockk<Context>()
        assertNull(UpdateChecker.getCachedUpdate(context))
        assertNull(UpdateChecker.saveCachedApkToDownloads(context))
        assertFalse(UpdateChecker.consumeRelaunchAfterUpdate(context))
        UpdateChecker.requestRelaunchAfterUpdate(context)
        val errors = mutableListOf<String>()
        UpdateChecker.downloadAndInstall(
            context,
            UpdateInfo("99.0", 9999, BuildConfig.APPLICATION_ID, "https://example.com/app.apk", "0".repeat(64)),
            { throw AssertionError("Disabled updater emitted progress") },
            errors::add,
        )
        assertEquals(1, errors.size)
        assertTrue(errors.single().contains("disabled"))
        assertFalse(UpdateChecker.isUpdateInstallInProgress())
        verify(exactly = 0) { context.getSharedPreferences(any(), any()) }
        verify(exactly = 0) { context.cacheDir }
        verify(exactly = 0) { context.packageManager }
    }

    @Test
    fun receiversAndRelaunchDoNotTouchContext() {
        val context = mockk<Context>()
        val intent = mockk<Intent>()
        // Avoid Android's local-unit-test BroadcastReceiver constructor stub.
        val installReceiver = mockk<UpdateInstallReceiver>()
        val relaunchReceiver = mockk<UpdateRelaunchReceiver>()
        every { installReceiver.onReceive(context, intent) } answers { callOriginal() }
        every { relaunchReceiver.onReceive(context, intent) } answers { callOriginal() }
        installReceiver.onReceive(context, intent)
        relaunchReceiver.onReceive(context, intent)
        UpdateRelaunchReceiver.launchPortal(context)
        verify(exactly = 0) { intent.action }
        verify(exactly = 0) { context.packageManager }
        verify(exactly = 0) { context.startActivity(any()) }
    }
}
