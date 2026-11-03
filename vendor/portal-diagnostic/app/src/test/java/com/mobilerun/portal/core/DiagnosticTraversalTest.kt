package com.mobilerun.portal.core

import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class DiagnosticTraversalTest {
    @Before fun setup() {
        mockkStatic(Log::class)
        every { Log.w(any(), any<String>()) } returns 0
        every { Log.e(any(), any<String>(), any<Throwable>()) } returns 0
    }
    @After fun cleanup() = unmockkAll()

    @Test fun refreshRunsBeforeEveryNodeFieldAndKeepsOriginalProperties() {
        val root = node("root")
        val child = node("child")
        every { root.childCount } returns 1
        every { root.getChild(0) } returns child
        listOf(root, child).forEach { n ->
            var refreshed = false
            every { n.refresh() } answers { refreshed = true; true }
            every { n.getBoundsInScreen(any()) } answers { check(refreshed) }
            every { n.packageName } answers { check(refreshed); "com.example" }
            every { n.className } answers { check(refreshed); "android.widget.TextView" }
        }
        val diagnostic = diagnostic()
        val result = AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, diagnostic = diagnostic)!!
        assertEquals("root", result.getString("text"))
        assertTrue(result.has("isContextClickable"))
        assertTrue(result.has("boundsInParent"))
        assertTrue(result.has("actionList"))
        assertEquals("child", result.getJSONArray("children").getJSONObject(0).getString("text"))
        assertEquals(2, diagnostic.visited)
        assertEquals(2, diagnostic.emitted)
        assertEquals(2, diagnostic.refreshOk)
        assertTrue(diagnostic.complete)
        verify(exactly = 1) { root.recycle(); child.recycle() }
    }

    @Test fun failedRefreshNeverReadsOldFieldsAndContinuesSibling() {
        val root = node("root")
        val stale = node("stale")
        val live = node("live")
        every { root.refresh() } returns true
        every { stale.refresh() } returns false
        every { live.refresh() } returns true
        every { root.childCount } returns 2
        every { root.getChild(0) } returns stale
        every { root.getChild(1) } returns live
        val diagnostic = diagnostic()
        val result = AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, diagnostic = diagnostic)!!
        assertEquals("live", result.getJSONArray("children").getJSONObject(0).getString("text"))
        assertEquals(1, result.getJSONArray("children").length())
        assertFalse(diagnostic.complete)
        assertEquals(1, diagnostic.refreshFailed)
        assertEquals(2, diagnostic.refreshOk)
        verify(exactly = 0) { stale.getBoundsInScreen(any()); stale.packageName; stale.childCount; stale.text }
        verify(exactly = 1) { stale.recycle() }
    }

    @Test fun nodeBudgetStopsBeforeAcquiringAnotherChild() {
        val root = node("root")
        val child = node("child")
        every { root.childCount } returns 2
        every { root.getChild(0) } returns child
        val diagnostic = AccessibilityTreeBuilder.DiagnosticTraversal(false, { 0L }, maxNodes = 2)
        val result = AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, diagnostic = diagnostic)!!
        assertEquals(1, result.getJSONArray("children").length())
        assertEquals(2, diagnostic.visited)
        assertEquals(1, diagnostic.nodeLimit)
        assertFalse(diagnostic.complete)
        verify(exactly = 0) { root.getChild(1) }
        verify(exactly = 1) { root.recycle(); child.recycle() }
    }

    @Test fun depthLimitAndCyclesRemainIncompleteWithoutRecyclingAncestorsEarly() {
        val nodes = (0..AccessibilityTraversalGuard.MAX_ACCESSIBILITY_TREE_DEPTH + 1).map { node("$it") }
        nodes.zipWithNext().forEach { (parent, child) ->
            every { parent.childCount } returns 1
            every { parent.getChild(0) } returns child
        }
        val diagnostic = AccessibilityTreeBuilder.DiagnosticTraversal(false, { 0L })
        assertNotNull(AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(nodes.first(), diagnostic = diagnostic))
        assertEquals(1, diagnostic.depthLimit)
        verify(exactly = 0) { nodes.last().getBoundsInScreen(any()) }
        nodes.forEach { verify(exactly = 1) { it.recycle() } }

        val root = node("cycle")
        val child = node("child")
        every { root.childCount } returns 1
        every { root.getChild(0) } returns child
        every { child.childCount } returns 1
        every { child.getChild(0) } returns root
        val cycle = AccessibilityTreeBuilder.DiagnosticTraversal(false, { 0L })
        assertNotNull(AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, diagnostic = cycle))
        assertEquals(1, cycle.cycle)
        assertFalse(cycle.complete)
        verify(exactly = 1) { root.recycle(); child.recycle() }
    }

    @Test fun serializationOverrunMarksTimeLimitEvenForLeaf() {
        var now = 0L
        val root = node("slow")
        every { root.text } answers { now = 8000L; "late" }
        val diagnostic = AccessibilityTreeBuilder.DiagnosticTraversal(false, { now })
        AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, diagnostic = diagnostic)
        assertFalse(diagnostic.complete)
        assertEquals(1, diagnostic.timeLimit)
        verify(exactly = 1) { root.recycle() }
    }

    @Test fun targetPackageFiltersRootsButPreservesRawEmbeddedChildren() {
        val root = node("root")
        val child = node("embedded")
        every { child.packageName } returns "com.embedded"
        every { root.childCount } returns 1
        every { root.getChild(0) } returns child
        val diagnostic = AccessibilityTreeBuilder.DiagnosticTraversal(false, { 0L }, targetPackage = "com.example")
        val result = AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, diagnostic = diagnostic)!!
        assertEquals("com.embedded", result.getJSONArray("children").getJSONObject(0).getString("packageName"))
        assertTrue(diagnostic.complete)
    }

    @Test fun acquiredLabelReferencesAreRecycledWithoutRecyclingActiveRoot() {
        val root = node("root")
        val label = node("label")
        every { root.labelFor } returns label
        every { root.labeledBy } returns root
        val diagnostic = AccessibilityTreeBuilder.DiagnosticTraversal(false, { 0L })
        val result = AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, diagnostic = diagnostic)!!
        assertTrue(result.getBoolean("hasLabelFor"))
        assertTrue(result.getBoolean("hasLabeledBy"))
        verify(exactly = 1) { label.recycle(); root.recycle() }
    }

    @Test fun nullChildrenAndBinderExceptionsCannotLookComplete() {
        val root = node("root")
        every { root.childCount } returns 2
        every { root.getChild(0) } returns null
        every { root.getChild(1) } throws IllegalStateException("binder")
        val diagnostic = AccessibilityTreeBuilder.DiagnosticTraversal(false, { 0L })
        assertNotNull(AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, diagnostic = diagnostic))
        assertFalse(diagnostic.complete)
        assertEquals(1, diagnostic.exception)
        assertEquals(2, diagnostic.nullChild)
    }

    private fun diagnostic() = AccessibilityTreeBuilder.DiagnosticTraversal(
        refreshEachNode = true, uptimeMillis = { 0L },
    )

    private fun node(text: String): AccessibilityNodeInfo = mockk<AccessibilityNodeInfo>(relaxed = true).also { n ->
        every { n.text } returns text
        every { n.packageName } returns "com.example"
        every { n.childCount } returns 0
        every { n.actionList } returns emptyList()
        every { n.rangeInfo } returns null
        every { n.collectionInfo } returns null
        every { n.collectionItemInfo } returns null
        every { n.extras } returns null as Bundle?
        every { n.labelFor } returns null
        every { n.labeledBy } returns null
        every { n.traversalBefore } returns null
        every { n.traversalAfter } returns null
    }
}
