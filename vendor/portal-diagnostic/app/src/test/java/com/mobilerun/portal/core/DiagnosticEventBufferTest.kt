package com.mobilerun.portal.core

import org.junit.Assert.*
import org.junit.Test

class DiagnosticEventBufferTest {
    @Test
    @Suppress("UNCHECKED_CAST") // Deliberate mutation attempts verify the Java unmodifiable wrappers.
    fun snapshotsDeepCopyAndFreezeMetadataWithoutRetainingFrameworkObjects() {
        val buffer = DiagnosticEventBuffer(2)
        val text = StringBuilder("original")
        val nested = mutableListOf<Any?>(text, mutableMapOf("ok" to true), null)
        val source = mutableMapOf<String, Any?>("text" to nested)
        buffer.append(source)
        val before = buffer.snapshot()
        text.append(" changed")
        (nested[1] as MutableMap<String, Any?>)["ok"] = false
        source.clear()
        buffer.append(mapOf("next" to 2))
        val events = before["events"] as List<*>
        assertEquals(1, events.size)
        val fields = (events[0] as Map<*, *>)["fields"] as Map<*, *>
        assertEquals(listOf("original", mapOf("ok" to true), null), fields["text"])
        expectUnsupported { (fields as MutableMap<String, Any?>)["injected"] = 1 }
        expectUnsupported { (fields["text"] as MutableList<Any?>).clear() }
        expectUnsupported { (before as MutableMap<String, Any?>).clear() }
    }

    @Test
    fun unsafeMetadataIsRejectedWithoutConsumingSequenceOrDroppingRecords() {
        val buffer = DiagnosticEventBuffer(1)
        buffer.append(mapOf("valid" to 1))
        val cyclic = mutableListOf<Any?>().apply { add(this) }
        val invalid = listOf(Any(), Double.NaN, Double.POSITIVE_INFINITY, mapOf(1 to "bad key"), cyclic)
        invalid.forEach { value ->
            try {
                buffer.append(mapOf("bad" to value))
                fail("accepted unsafe metadata")
            } catch (_: IllegalArgumentException) { }
        }
        assertEquals(1L, buffer.snapshot()["lastSeq"])
        assertEquals(0L, buffer.snapshot()["droppedCount"])
        try { DiagnosticEventBuffer(0); fail("zero capacity") } catch (_: IllegalArgumentException) { }
    }

    @Test
    fun concurrentAppendsProduceUniqueOrderedSequencesWithinCapacity() {
        val buffer = DiagnosticEventBuffer(25)
        val start = java.util.concurrent.CountDownLatch(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(4)
        try {
            val workers = (1..4).map { worker -> pool.submit {
                start.await()
                repeat(100) { buffer.append(mapOf("worker" to worker, "item" to it)) }
            } }
            start.countDown()
            workers.forEach { it.get(2, java.util.concurrent.TimeUnit.SECONDS) }
            val snapshot = buffer.snapshot()
            val sequences = (snapshot["events"] as List<*>).map { (it as Map<*, *>)["seq"] }
            assertEquals((376L..400L).toList(), sequences)
            assertEquals(375L, snapshot["droppedCount"])
            assertEquals(400L, snapshot["lastSeq"])
        } finally { pool.shutdownNow() }
    }

    @Test
    fun emptySnapshotHasNoRetainedSequence() {
        val snapshot = DiagnosticEventBuffer().snapshot()
        assertEquals(emptyList<Any?>(), snapshot["events"])
        assertNull(snapshot["firstSeq"])
        assertEquals(0L, snapshot["lastSeq"])
        assertEquals(0L, snapshot["droppedCount"])
    }

    private fun expectUnsupported(block: () -> Unit) {
        try { block() } catch (_: UnsupportedOperationException) { return }
        fail("snapshot was mutable")
    }
    @Test
    fun ringRetainsNewestThousandWithMonotonicSequencesAndDroppedCount() {
        val buffer = DiagnosticEventBuffer()
        repeat(1_005) { buffer.append(mapOf("eventType" to it)) }
        val snapshot = buffer.snapshot()
        val events = snapshot["events"] as List<*>
        assertEquals(1_000, events.size)
        assertEquals(5L, snapshot["droppedCount"])
        assertEquals(6L, snapshot["firstSeq"])
        assertEquals(1_005L, snapshot["lastSeq"])
        assertEquals(1_005L, (events.last() as Map<*, *>)["seq"])
        assertEquals(1_004, ((events.last() as Map<*, *>)["fields"] as Map<*, *>)["eventType"])
    }
}
