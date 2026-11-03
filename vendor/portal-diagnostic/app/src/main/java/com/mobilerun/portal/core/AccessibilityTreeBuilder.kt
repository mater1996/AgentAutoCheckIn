package com.mobilerun.portal.core

import android.graphics.Rect
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * Utility class for building comprehensive JSON representations of accessibility trees
 */
object AccessibilityTreeBuilder {
    private const val TAG = "AccessibilityTreeBuilder"

    private const val MIN_ELEMENT_SIZE = 5

    private const val VISIBILITY_THRESHOLD = 0.01f  // 1% visibility threshold

    /**
     * Builds a comprehensive JSON object from an AccessibilityNodeInfo node,
     * extracting all available properties and recursively processing children.
     * Optionally filters out nodes that are less than 10% visible on screen.
     *
     * @param node The AccessibilityNodeInfo to convert to JSON
     * @param screenBounds The visible screen bounds for filtering (null to disable filtering)
     * @return JSONObject containing all extractable node information, or null if filtered out
     */
    fun buildFullAccessibilityTreeJson(
        node: AccessibilityNodeInfo,
        screenBounds: Rect? = null,
        diagnostic: DiagnosticTraversal? = null,
    ): JSONObject? {
        return buildFullAccessibilityTreeJson(node, screenBounds, 0, mutableSetOf(), diagnostic)
    }

    /** One request's cooperative budget and observations; never shared between reads. */
    class DiagnosticTraversal(
        val refreshEachNode: Boolean,
        private val uptimeMillis: () -> Long = { android.os.SystemClock.uptimeMillis() },
        private val startedUptimeMillis: Long = uptimeMillis(),
        private val maxNodes: Int = 1200,
        private val timeBudgetMillis: Long = 8000,
        val targetPackage: String? = null,
    ) {
        var visited = 0
        var emitted = 0
        var nullChild = 0
        var refreshOk = 0
        var refreshFailed = 0
        var exception = 0
        var depthLimit = 0
        var nodeLimit = 0
        var timeLimit = 0
        var cycle = 0
        val reasons = linkedSetOf<String>()
        val complete: Boolean get() = reasons.isEmpty()

        fun incomplete(reason: String) { reasons += reason }
        fun exception() { exception++; incomplete("exception") }
        fun withinTime(): Boolean {
            if (uptimeMillis() - startedUptimeMillis >= timeBudgetMillis) {
                if (timeLimit == 0) timeLimit++
                incomplete("time_limit")
                return false
            }
            return true
        }
        fun canVisit(): Boolean {
            if (!withinTime()) return false
            if (visited >= maxNodes) {
                if (nodeLimit == 0) nodeLimit++
                incomplete("node_limit")
                return false
            }
            return true
        }
        fun beforeNode(node: AccessibilityNodeInfo, depth: Int): Boolean {
            if (!canVisit()) return false
            if (AccessibilityTraversalGuard.isTooDeep(depth)) {
                depthLimit++; incomplete("depth_limit"); return false
            }
            visited++
            if (refreshEachNode) {
                val refreshed = try { node.refresh() } catch (_: RuntimeException) {
                    exception(); false
                }
                if (!refreshed) {
                    refreshFailed++; incomplete("refresh_failed"); return false
                }
                refreshOk++
            }
            return withinTime()
        }
    }

    private fun buildFullAccessibilityTreeJson(
        node: AccessibilityNodeInfo,
        screenBounds: Rect?,
        depth: Int,
        activeNodePath: MutableSet<AccessibilityNodeInfo>,
        diagnostic: DiagnosticTraversal?,
    ): JSONObject? {
        if (diagnostic != null) {
            val accepted = try {
                diagnostic.beforeNode(node, depth) &&
                    (depth != 0 || diagnostic.targetPackage == null || node.packageName?.toString() == diagnostic.targetPackage)
            } catch (_: RuntimeException) {
                diagnostic.exception(); false
            }
            if (!accepted) {
                recycleNode(node, diagnostic)
                return null
            }
        }
        val rect = Rect()
        try {
            node.getBoundsInScreen(rect)
        } catch (e: RuntimeException) {
            diagnostic?.exception()
            Log.e(TAG, "Unable to read accessibility node bounds: ${e.message}", e)
            recycleNode(node, diagnostic)
            return null
        }

        val nodeKey = AccessibilityTraversalGuard.createTraversalKey(node, rect)
        if (AccessibilityTraversalGuard.isTooDeep(depth)) {
            Log.w(
                TAG,
                "Skipping accessibility subtree deeper than " +
                    "${AccessibilityTraversalGuard.MAX_ACCESSIBILITY_TREE_DEPTH} levels: $nodeKey",
            )
            recycleNode(node, diagnostic)
            return null
        }
        if (!AccessibilityTraversalGuard.enterActivePath(node, activeNodePath)) {
            diagnostic?.apply { cycle++; incomplete("cycle") }
            Log.w(
                TAG,
                "Skipping cyclic accessibility node while building full tree: $nodeKey",
            )
            if (!AccessibilityTraversalGuard.isActiveNodeReference(node, activeNodePath)) {
                recycleNode(node, diagnostic)
            }
            return null
        }

        try {
            // Check this node's validity (only if filtering is enabled)
            val nodePassesFilter = if (screenBounds != null) {
                val visiblePercentage = getVisiblePercentage(rect, screenBounds)
                visiblePercentage >= VISIBILITY_THRESHOLD
            } else {
                true  // No filtering, always passes
            }

            // Process children FIRST (before deciding on this node)
            val childrenArray = JSONArray()
            val childCount = try {
                node.childCount
            } catch (e: RuntimeException) {
                diagnostic?.exception()
                Log.e(TAG, "Unable to read child count for accessibility node $nodeKey: ${e.message}", e)
                0
            }
            for (i in 0 until childCount) {
                if (diagnostic != null && !diagnostic.canVisit()) break
                val child = try {
                    node.getChild(i)
                } catch (e: RuntimeException) {
                    diagnostic?.exception()
                    Log.e(
                        TAG,
                        "Unable to read child accessibility node index=$i parent=$nodeKey: ${e.message}",
                        e,
                    )
                    null
                }
                if (child == null) {
                    diagnostic?.apply { nullChild++; incomplete("null_child") }
                    continue
                }

                if (child === node) {
                    diagnostic?.apply { cycle++; incomplete("cycle") }
                    Log.w(TAG, "Skipping child accessibility node that references its parent: $nodeKey")
                    continue
                }

                if (AccessibilityTraversalGuard.isActiveNodeReference(child, activeNodePath)) {
                    diagnostic?.apply { cycle++; incomplete("cycle") }
                    Log.w(TAG, "Skipping child accessibility node that references an active ancestor: $nodeKey")
                    continue
                }

                val childJson = buildFullAccessibilityTreeJson(
                    child,
                    screenBounds,
                    depth + 1,
                    activeNodePath,
                    diagnostic,
                )
                if (childJson != null) {
                    childrenArray.put(childJson)
                }
            }

            // Parent preservation: keep if passes filter OR has valid children
            if (!nodePassesFilter && childrenArray.length() == 0) {
                return null
            }

            // Build JSON with full properties
            if (diagnostic != null && !diagnostic.withinTime()) return null
            return JSONObject().apply {
            // Basic identification
            put("resourceId", node.viewIdResourceName ?: "")
            put("className", node.className?.toString() ?: "")
            put("packageName", node.packageName?.toString() ?: "")

            // Text content
            put("text", node.text?.toString() ?: "")
            put("contentDescription", node.contentDescription?.toString() ?: "")
            put("hint", node.hintText?.toString() ?: "")
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                put("stateDescription", node.stateDescription?.toString() ?: "")
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                put("tooltipText", node.tooltipText?.toString() ?: "")
                put("paneTitle", node.paneTitle?.toString() ?: "")
            }
            put("error", node.error?.toString() ?: "")

            // Bounds (reuse rect we already computed)
            put("boundsInScreen", JSONObject().apply {
                put("left", rect.left)
                put("top", rect.top)
                put("right", rect.right)
                put("bottom", rect.bottom)
            })

            val boundsInParent = Rect()
            node.getBoundsInParent(boundsInParent)
            put("boundsInParent", JSONObject().apply {
                put("left", boundsInParent.left)
                put("top", boundsInParent.top)
                put("right", boundsInParent.right)
                put("bottom", boundsInParent.bottom)
            })

            // Boolean states - Clickability
            put("isClickable", node.isClickable)
            put("isLongClickable", node.isLongClickable)
            put("isContextClickable", node.isContextClickable)

            // Boolean states - Focus
            put("isFocusable", node.isFocusable)
            put("isFocused", node.isFocused)
            put("isAccessibilityFocused", node.isAccessibilityFocused)

            // Boolean states - Selection
            put("isSelected", node.isSelected)

            // Boolean states - Checkable
            put("isCheckable", node.isCheckable)
            put("isChecked", node.isChecked)

            // Boolean states - Enabled/Visible
            put("isEnabled", node.isEnabled)
            put("isVisibleToUser", node.isVisibleToUser)

            // Boolean states - Editable/Input
            put("isEditable", node.isEditable)
            put("isPassword", node.isPassword)
            put("isShowingHintText", node.isShowingHintText)

            // Boolean states - Scrollable
            put("isScrollable", node.isScrollable)

            // Boolean states - Dismissable
            put("isDismissable", node.isDismissable)

            // Boolean states - Multi-line
            put("isMultiLine", node.isMultiLine)

            // Boolean states - Importance
            put("isImportantForAccessibility", node.isImportantForAccessibility)

            // Boolean states - Screen reader
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                put("isScreenReaderFocusable", node.isScreenReaderFocusable)
                put("isHeading", node.isHeading)
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                put("isTextSelectable", node.isTextSelectable)
            }

            // Text selection info
            if (node.text != null) {
                put("textSelectionStart", node.textSelectionStart)
                put("textSelectionEnd", node.textSelectionEnd)
            }

            // Input type
            put("inputType", node.inputType)

            // Live region
            put("liveRegion", node.liveRegion)

            // Window info
            put("windowId", node.windowId)

            // Drawing order
            put("drawingOrder", node.drawingOrder)

            // Max text length
            put("maxTextLength", node.maxTextLength)

            // Movement granularities
            put("movementGranularities", node.movementGranularities)

            // Child and action counts
            put("childCount", node.childCount)
            put("actionCount", node.actionList?.size ?: 0)

            // Range info (for progress bars, sliders, etc.)
            node.rangeInfo?.let { range ->
                put("rangeInfo", JSONObject().apply {
                    put("type", range.type)
                    put("min", jsonFiniteFloatOrNull(range.min))
                    put("max", jsonFiniteFloatOrNull(range.max))
                    put("current", jsonFiniteFloatOrNull(range.current))
                })
            }

            // Collection info (for lists, grids, etc.)
            node.collectionInfo?.let { collection ->
                put("collectionInfo", JSONObject().apply {
                    put("rowCount", collection.rowCount)
                    put("columnCount", collection.columnCount)
                    put("isHierarchical", collection.isHierarchical)
                    put("selectionMode", collection.selectionMode)
                })
            }

            // Collection item info (for items in lists/grids)
            node.collectionItemInfo?.let { item ->
                put("collectionItemInfo", JSONObject().apply {
                    put("rowIndex", item.rowIndex)
                    put("rowSpan", item.rowSpan)
                    put("columnIndex", item.columnIndex)
                    put("columnSpan", item.columnSpan)
                    put("isHeading", item.isHeading)
                    put("isSelected", item.isSelected)
                })
            }

            // Touch delegate info
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                node.touchDelegateInfo?.let { touchDelegate ->
                    put("hasTouchDelegate", true)
                    put("touchDelegateRegionCount", touchDelegate.regionCount)
                }
            }

            // Extras bundle (custom data)
            val extras = node.extras
            if (extras != null && !extras.isEmpty) {
                val extrasJson = JSONObject()
                for (key in extras.keySet()) {
                    try {
                        val value = extras.get(key)
                        when (value) {
                            is String -> extrasJson.put(key, value)
                            is Int -> extrasJson.put(key, value)
                            is Long -> extrasJson.put(key, value)
                            is Boolean -> extrasJson.put(key, value)
                            is Double -> extrasJson.put(key, value)
                            is Float -> extrasJson.put(key, value)
                            else -> extrasJson.put(key, value.toString())
                        }
                    } catch (e: Exception) {
                        diagnostic?.exception()
                        // Skip if we can't serialize this extra
                    }
                }
                put("extras", extrasJson)
            }

            // Action list (with all available details)
            val actionsArray = JSONArray()
            node.actionList?.sortedBy { it.id }?.forEach { action ->
                val actionObj = JSONObject().apply {
                    put("id", action.id)
                    put("label", action.label?.toString() ?: "")

                    // Map common action IDs to readable names
                    val actionName = when (action.id) {
                        AccessibilityNodeInfo.ACTION_CLICK -> "CLICK"
                        AccessibilityNodeInfo.ACTION_LONG_CLICK -> "LONG_CLICK"
                        AccessibilityNodeInfo.ACTION_SCROLL_FORWARD -> "SCROLL_FORWARD"
                        AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD -> "SCROLL_BACKWARD"
                        AccessibilityNodeInfo.ACTION_FOCUS -> "FOCUS"
                        AccessibilityNodeInfo.ACTION_CLEAR_FOCUS -> "CLEAR_FOCUS"
                        AccessibilityNodeInfo.ACTION_SELECT -> "SELECT"
                        AccessibilityNodeInfo.ACTION_CLEAR_SELECTION -> "CLEAR_SELECTION"
                        AccessibilityNodeInfo.ACTION_SET_TEXT -> "SET_TEXT"
                        AccessibilityNodeInfo.ACTION_COPY -> "COPY"
                        AccessibilityNodeInfo.ACTION_PASTE -> "PASTE"
                        AccessibilityNodeInfo.ACTION_CUT -> "CUT"
                        else -> "UNKNOWN_${action.id}"
                    }
                    put("name", actionName)
                }
                actionsArray.put(actionObj)
            }
            put("actionList", actionsArray)

            // Labeling information
            node.labelFor?.let {
                put("hasLabelFor", true)
                recycleDiagnosticReference(it, activeNodePath, diagnostic)
            }
            node.labeledBy?.let {
                put("hasLabeledBy", true)
                recycleDiagnosticReference(it, activeNodePath, diagnostic)
            }
            node.traversalBefore?.let {
                put("hasTraversalBefore", true)
                recycleDiagnosticReference(it, activeNodePath, diagnostic)
            }
            node.traversalAfter?.let {
                put("hasTraversalAfter", true)
                recycleDiagnosticReference(it, activeNodePath, diagnostic)
            }

            // Unique ID (API 33+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                node.uniqueId?.let {
                    put("uniqueId", it)
                }
            }

            // Container title (API 34+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                node.containerTitle?.let {
                    put("containerTitle", it.toString())
                }
            }

            // Use children array built earlier
            put("children", childrenArray)
            }.also { diagnostic?.apply { emitted++; withinTime() } }
        } catch (e: RuntimeException) {
            diagnostic?.exception()
            Log.e(TAG, "Unable to build full accessibility tree node $nodeKey: ${e.message}", e)
            return null
        } finally {
            AccessibilityTraversalGuard.leaveActivePath(node, activeNodePath)
            recycleNode(node, diagnostic)
        }
    }

    private fun recycleDiagnosticReference(
        node: AccessibilityNodeInfo,
        activeNodePath: Set<AccessibilityNodeInfo>,
        diagnostic: DiagnosticTraversal?,
    ) {
        if (diagnostic != null && !AccessibilityTraversalGuard.isActiveNodeReference(node, activeNodePath)) {
            recycleNode(node, diagnostic)
        }
    }

    private fun recycleNode(node: AccessibilityNodeInfo, diagnostic: DiagnosticTraversal?) {
        if (diagnostic == null) {
            node.recycle()
        } else {
            try { node.recycle() } catch (_: RuntimeException) { diagnostic.exception() }
        }
    }

    private fun jsonFiniteFloatOrNull(value: Float): Any {
        return if (value.isFinite()) value.toDouble() else JSONObject.NULL
    }

    private fun getVisiblePercentage(rect: Rect, screenBounds: Rect): Float {
        val width = rect.right - rect.left
        val height = rect.bottom - rect.top
        val totalArea = width * height

        if (totalArea <= 0) return 0f

        // Check if element fully contains screen (overflow case)
        if (rect.left <= 0 && rect.top <= 0 &&
            rect.right >= screenBounds.right && rect.bottom >= screenBounds.bottom) {
            return 1f
        }

        // Calculate visible portion
        val visibleLeft = maxOf(rect.left, screenBounds.left)
        val visibleTop = maxOf(rect.top, screenBounds.top)
        val visibleRight = minOf(rect.right, screenBounds.right)
        val visibleBottom = minOf(rect.bottom, screenBounds.bottom)

        val visibleWidth = maxOf(0, visibleRight - visibleLeft)
        val visibleHeight = maxOf(0, visibleBottom - visibleTop)
        val visibleArea = visibleWidth * visibleHeight

        return visibleArea.toFloat() / totalArea.toFloat()
    }
}
