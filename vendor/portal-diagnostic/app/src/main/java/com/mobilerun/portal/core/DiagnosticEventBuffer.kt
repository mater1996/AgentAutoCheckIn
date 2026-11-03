package com.mobilerun.portal.core

import java.util.ArrayDeque
import java.util.Collections
import java.util.IdentityHashMap

/**
 * Bounded immutable event metadata. Callers copy event fields without reading event.source.
 * Only JSON primitives, CharSequences (copied to Strings), string-key maps and lists are accepted.
 * Unsupported objects, cycles and nonfinite numbers are rejected before altering the ring.
 */
class DiagnosticEventBuffer(private val capacity: Int = 1_000) {
    private val events = ArrayDeque<Map<String, Any?>>()
    private var sequence = 0L
    private var droppedCount = 0L

    init { require(capacity > 0) { "capacity must be positive" } }

    @Synchronized
    fun append(fields: Map<String, Any?>) {
        val copied = copyMap(fields, IdentityHashMap())
        sequence++
        if (events.size == capacity) {
            events.removeFirst()
            droppedCount++
        }
        events.addLast(Collections.unmodifiableMap(mapOf("seq" to sequence, "fields" to copied)))
    }

    /** firstSeq is null for an empty ring; lastSeq is the last assigned sequence (initially zero). */
    @Synchronized
    fun snapshot(): Map<String, Any?> = Collections.unmodifiableMap(mapOf(
        "events" to Collections.unmodifiableList(events.toList()),
        "droppedCount" to droppedCount,
        "firstSeq" to events.peekFirst()?.get("seq"),
        "lastSeq" to sequence,
    ))

    private fun copyMap(source: Map<*, *>, ancestors: IdentityHashMap<Any, Boolean>): Map<String, Any?> {
        require(ancestors.put(source, true) == null) { "cyclic metadata" }
        try {
            val copy = LinkedHashMap<String, Any?>()
            source.forEach { (key, value) ->
                require(key is String) { "metadata map keys must be strings" }
                copy[key] = copyValue(value, ancestors)
            }
            return Collections.unmodifiableMap(copy)
        } finally { ancestors.remove(source) }
    }

    private fun copyValue(value: Any?, ancestors: IdentityHashMap<Any, Boolean>): Any? = when (value) {
        null, is Boolean, is Byte, is Short, is Int, is Long -> value
        is CharSequence -> value.toString()
        is Double -> value.also { require(it.isFinite()) { "nonfinite metadata number" } }
        is Float -> value.also { require(it.isFinite()) { "nonfinite metadata number" } }
        is Map<*, *> -> copyMap(value, ancestors)
        is List<*> -> {
            require(ancestors.put(value, true) == null) { "cyclic metadata" }
            try { Collections.unmodifiableList(value.map { copyValue(it, ancestors) }) }
            finally { ancestors.remove(value) }
        }
        else -> throw IllegalArgumentException("metadata must contain only JSON values")
    }
}
