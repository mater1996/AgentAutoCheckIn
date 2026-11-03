package com.mobilerun.portal.core

import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.mobilerun.portal.service.MobilerunAccessibilityService
import io.mockk.*
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class DiagnosticTreeReaderTest {
    @Before fun setup() {
        mockkStatic(SystemClock::class, Log::class)
        every { SystemClock.uptimeMillis() } returns 100L
        every { Log.w(any(), any<String>()) } returns 0
        every { Log.e(any(), any<String>(), any<Throwable>()) } returns 0
    }
    @After fun cleanup() = unmockkAll()

    @Test fun requiresExplicitUnfilteredValidRequestBeforeAccessingService() {
        val service = mockk<MobilerunAccessibilityService>()
        listOf(
            params().apply { remove("filter") },
            params().put("filter", "false"),
            params().put("filter", true),
            params().put("requestId", ""),
            params().put("package", "invalid package"),
            params().put("mode", "other"),
        ).forEach { invalid ->
            try { DiagnosticTreeReader.read(service, invalid); fail("Accepted invalid request") }
            catch (_: IllegalArgumentException) { }
        }
        confirmVerified(service)
    }

    @Test fun baselineBuildsFreshRawTreeWithRequestMetadataAndRecycles() {
        val service = service()
        val root = node("current")
        every { service.rootInActiveWindow } returns root
        val result = DiagnosticTreeReader.read(service, params())
        assertEquals("request-1", result.getString("requestId"))
        assertEquals("baseline", result.getString("mode"))
        assertEquals("com.example", result.getString("package"))
        assertFalse(result.getBoolean("reused"))
        assertTrue(result.getString("sessionId").isNotBlank())
        assertEquals(100L, result.getLong("startUptimeMs"))
        assertEquals(100L, result.getLong("endUptimeMs"))
        assertTrue(result.isNull("cacheClear"))
        assertTrue(result.getBoolean("complete"))
        assertFalse(result.getBoolean("incomplete"))
        assertEquals("current", result.getJSONObject("a11y_tree").getString("text"))
        assertEquals(1, result.getInt("rootCount"))
        assertEquals(1, result.getJSONObject("counts").getInt("visited"))
        verify(exactly = 0) { root.refresh() }
        verify(exactly = 1) { root.recycle() }
    }

    @Test fun clearRunsBeforeAnyRootOrWindowAcquisition() {
        val service = service()
        var cleared = false
        every { service.clearCache() } answers { cleared = true; true }
        every { service.rootInActiveWindow } answers { check(cleared); node("after clear") }
        every { service.windows } answers { check(cleared); emptyList() }
        val result = DiagnosticTreeReader.read(service, params("clear_android_cache"), sdkInt = 34)
        assertTrue(result.getBoolean("cacheClear"))
        assertTrue(result.getBoolean("complete"))
        verify(exactly = 1) { service.clearCache() }
    }

    @Test fun failedClearAbortsWithoutGettingRootsOrReturningPreviousTree() {
        val service = service()
        every { service.rootInActiveWindow } returns node("previous")
        assertFalse(DiagnosticTreeReader.read(service, params()).isNull("a11y_tree"))
        clearMocks(service, answers = false)
        every { service.clearCache() } returns false
        val result = DiagnosticTreeReader.read(service, params("clear_android_cache"), sdkInt = 34)
        assertFalse(result.getBoolean("cacheClear"))
        assertTrue(result.getBoolean("incomplete"))
        assertTrue(result.isNull("a11y_tree"))
        verify(exactly = 0) { service.rootInActiveWindow; service.windows }
    }

    @Test fun capturesWindowMetadataAndOnlyCountsEmittedTargetRoots() {
        val service = service()
        val foreign = node("foreign")
        every { foreign.packageName } returns "com.other"
        val target = node("target")
        every { service.rootInActiveWindow } returns foreign
        every { foreign.windowId } returns 1
        val lower = mockk<android.view.accessibility.AccessibilityWindowInfo>(relaxed = true)
        val upper = mockk<android.view.accessibility.AccessibilityWindowInfo>(relaxed = true)
        every { lower.id } returns 1
        every { lower.layer } returns 0
        every { lower.type } returns 1
        every { lower.isActive } returns true
        every { lower.isFocused } returns true
        every { upper.id } returns 2
        every { upper.layer } returns 2
        every { upper.type } returns 1
        every { upper.root } returns target
        every { service.windows } returns listOf(lower, upper)
        val result = DiagnosticTreeReader.read(service, params())
        assertEquals(2, result.getJSONArray("windows").length())
        assertTrue(result.getJSONArray("windows").getJSONObject(0).getBoolean("active"))
        assertTrue(result.getJSONArray("windows").getJSONObject(0).getBoolean("focused"))
        assertEquals(1, result.getInt("rootCount"))
        assertEquals("target", result.getJSONObject("a11y_tree").getString("text"))
        assertFalse(result.getJSONArray("selectedRoots").getJSONObject(0).getBoolean("selected"))
        assertTrue(result.getJSONArray("selectedRoots").getJSONObject(1).getBoolean("selected"))
        verify(exactly = 2) { lower.recycle(); upper.recycle() }
        verify(exactly = 1) { foreign.recycle(); target.recycle() }
    }

    @Test fun refreshModeChecksRootPackageOnlyAfterRefreshAndNeverUsesFailedRootFields() {
        val service = service()
        val root = node("stale")
        every { root.refresh() } returns false
        every { service.rootInActiveWindow } returns root
        val result = DiagnosticTreeReader.read(service, params("refresh_each_node"))
        assertTrue(result.getBoolean("incomplete"))
        assertTrue(result.isNull("a11y_tree"))
        assertEquals(1, result.getJSONObject("counts").getInt("refreshFailed"))
        verify(exactly = 0) { root.packageName; root.getBoundsInScreen(any()); root.childCount; root.text }
        verify(exactly = 1) { root.recycle() }
    }

    @Test fun cacheClearUnsupportedOnOldApiNeverInvokesNewApiOrResolvesRoots() {
        val service = service()
        val result = DiagnosticTreeReader.read(service, params("clear_android_cache"), sdkInt = 32)
        assertTrue(result.getBoolean("incomplete"))
        assertFalse(result.getBoolean("cacheClear"))
        verify(exactly = 0) { service.clearCache(); service.rootInActiveWindow; service.windows }
    }

    @Test fun entireReadBudgetIncludesRootResolutionAndNeverFallsBack() {
        val service = service()
        val root = node("late")
        var now = 0L
        every { SystemClock.uptimeMillis() } answers { now }
        every { service.rootInActiveWindow } answers { now = 8000L; root }
        val result = DiagnosticTreeReader.read(service, params())
        assertTrue(result.getBoolean("timeout"))
        assertTrue(result.getBoolean("incomplete"))
        assertTrue(result.isNull("a11y_tree"))
        verify(exactly = 0) { root.getBoundsInScreen(any()); root.packageName; root.childCount }
        verify(exactly = 1) { root.recycle() }
    }

    private fun service() = mockk<MobilerunAccessibilityService>(relaxed = true).also {
        every { it.windows } returns emptyList()
        every { it.rootInActiveWindow } returns null
    }

    private fun node(text: String) = mockk<AccessibilityNodeInfo>(relaxed = true).also {
        every { it.packageName } returns "com.example"
        every { it.text } returns text
        every { it.childCount } returns 0
        every { it.actionList } returns emptyList()
        every { it.rangeInfo } returns null
        every { it.collectionInfo } returns null
        every { it.collectionItemInfo } returns null
        every { it.extras } returns null
        every { it.labelFor } returns null
        every { it.labeledBy } returns null
        every { it.traversalBefore } returns null
        every { it.traversalAfter } returns null
    }

    private fun params(mode: String = "baseline") = JSONObject()
        .put("requestId", "request-1").put("mode", mode)
        .put("package", "com.example").put("filter", false)
}
