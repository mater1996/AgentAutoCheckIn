package com.mobilerun.portal.core

import android.os.SystemClock
import org.json.JSONArray
import java.util.UUID
import com.mobilerun.portal.service.MobilerunAccessibilityService
import org.json.JSONObject

/** Invoked only by the diagnostic coordinator's exclusive worker. */
object DiagnosticTreeReader {
    private val sessionId = UUID.randomUUID().toString()

    fun read(service: MobilerunAccessibilityService, params: JSONObject): JSONObject =
        read(service, params, android.os.Build.VERSION.SDK_INT)

    internal fun read(service: MobilerunAccessibilityService, params: JSONObject, sdkInt: Int): JSONObject {
        require(params.opt("filter") == false) { "filter must explicitly be false" }
        val requestId = params.opt("requestId") as? String
        require(requestId != null && requestId.matches(Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"))) {
            "requestId must be 1..128 safe identifier characters"
        }
        val targetPackage = params.opt("package") as? String
        require(targetPackage != null && targetPackage.matches(Regex("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+"))) {
            "package must be an Android package name"
        }
        require(params.opt("mode") in setOf("baseline", "clear_android_cache", "refresh_each_node")) {
            "mode must be baseline, clear_android_cache or refresh_each_node"
        }
        val mode = params.getString("mode")
        val start = SystemClock.uptimeMillis()
        val traversal = AccessibilityTreeBuilder.DiagnosticTraversal(
            refreshEachNode = mode == "refresh_each_node",
            startedUptimeMillis = start,
            targetPackage = targetPackage,
        )
        var cacheClear: Boolean? = null
        val mayResolve = if (mode == "clear_android_cache") {
            cacheClear = if (sdkInt < 33) {
                traversal.incomplete("cache_clear_unsupported"); false
            } else {
                try { service.clearCache() } catch (_: RuntimeException) {
                    traversal.exception(); false
                }
            }
            if (cacheClear != true) traversal.incomplete("cache_clear_failed")
            cacheClear == true
        } else true
        val windows = JSONArray()
        if (mayResolve && traversal.withinTime()) {
            val snapshot = try { service.windows } catch (_: RuntimeException) {
                traversal.exception(); emptyList()
            }
            snapshot?.forEach { window ->
                try {
                    windows.put(JSONObject().put("id", window.id).put("type", window.type)
                        .put("layer", window.layer).put("active", window.isActive)
                        .put("focused", window.isFocused))
                } catch (_: RuntimeException) {
                    traversal.exception()
                } finally {
                    try { window.recycle() } catch (_: RuntimeException) { traversal.exception() }
                }
            }
        }
        val selectedRoots = JSONArray()
        var rootCount = 0
        var tree: JSONObject? = null
        val candidates = if (mayResolve && traversal.withinTime()) {
            AccessibilityRootResolver.resolve(service)
        } else emptyList()
        candidates.forEachIndexed { index, candidate ->
            val rootTree = AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(
                candidate.root, diagnostic = traversal,
            )
            selectedRoots.put(JSONObject().put("order", index).put("windowId", candidate.windowId)
                .put("layer", candidate.layer).put("selected", rootTree != null)
                .put("reason", if (rootTree != null) "resolver_order_package_match" else "package_mismatch_or_incomplete"))
            if (rootTree != null) {
                rootCount++
                val primary = tree
                if (primary == null) tree = rootTree
                else primary.getJSONArray("children").put(rootTree)
            }
        }
        if (tree == null) traversal.incomplete("no_target_root")
        traversal.withinTime()
        return JSONObject()
            .put("requestId", requestId).put("mode", mode).put("package", targetPackage)
            .put("sessionId", sessionId).put("startUptimeMs", start)
            .put("endUptimeMs", SystemClock.uptimeMillis()).put("reused", false)
            .put("cacheClear", cacheClear ?: JSONObject.NULL).put("windows", windows)
            .put("selectedRoots", selectedRoots).put("rootCount", rootCount)
            .put("counts", JSONObject().put("visited", traversal.visited).put("emitted", traversal.emitted)
                .put("nullChild", traversal.nullChild).put("refreshOk", traversal.refreshOk)
                .put("refreshFailed", traversal.refreshFailed).put("exception", traversal.exception)
                .put("depthLimit", traversal.depthLimit).put("nodeLimit", traversal.nodeLimit)
                .put("timeLimit", traversal.timeLimit).put("cycle", traversal.cycle))
            .put("complete", traversal.complete).put("incomplete", !traversal.complete)
            .put("incompleteReasons", JSONArray(traversal.reasons.toList()))
            .put("timeout", traversal.timeLimit > 0).put("blocked", false)
            .put("a11y_tree", tree ?: JSONObject.NULL)
    }
}
