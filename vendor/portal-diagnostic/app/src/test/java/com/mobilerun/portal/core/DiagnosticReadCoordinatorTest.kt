package com.mobilerun.portal.core

import org.junit.Assert.*
import org.junit.Test

class DiagnosticReadCoordinatorTest {
    @Test
    fun diagnosticRejectsNormalReadsAndOtherDiagnosticsUntilWorkerActuallyExits() {
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val exited = java.util.concurrent.CountDownLatch(1)
        val caller = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            val result = caller.submit<Throwable?> {
                try {
                    DiagnosticReadCoordinator.diagnostic(timeoutMs = 100) {
                        entered.countDown()
                        try { release.await() } finally { exited.countDown() }
                    }
                    null
                } catch (failure: Throwable) { failure }
            }
            assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
            assertTrue(DiagnosticReadCoordinator.isDiagnosticRunning)
            expect<DiagnosticReadCoordinator.Busy> { DiagnosticReadCoordinator.normalRead { fail("admitted") } }
            expect<DiagnosticReadCoordinator.Busy> { DiagnosticReadCoordinator.diagnostic { fail("second worker") } }
            assertTrue(result.get(2, java.util.concurrent.TimeUnit.SECONDS) is DiagnosticReadCoordinator.Timeout)
            assertTrue(DiagnosticReadCoordinator.isDiagnosticRunning)
            expect<DiagnosticReadCoordinator.Busy> { DiagnosticReadCoordinator.normalRead { fail("released on timeout") } }
        } finally {
            release.countDown()
            assertTrue(exited.await(2, java.util.concurrent.TimeUnit.SECONDS))
            awaitIdle()
            caller.shutdownNow()
        }
        assertEquals("next", DiagnosticReadCoordinator.diagnostic { DiagnosticReadCoordinator.normalRead { "next" } })
    }

    @Test
    fun reservationDrainsExistingReadersAndAllowsTheirNestedReads() {
        val readerEntered = java.util.concurrent.CountDownLatch(1)
        val nestNow = java.util.concurrent.CountDownLatch(1)
        val nested = java.util.concurrent.CountDownLatch(1)
        val releaseReader = java.util.concurrent.CountDownLatch(1)
        val diagnosticEntered = java.util.concurrent.CountDownLatch(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val reader = pool.submit<Int> {
                DiagnosticReadCoordinator.normalRead {
                    readerEntered.countDown()
                    nestNow.await()
                    DiagnosticReadCoordinator.normalRead { nested.countDown() }
                    releaseReader.await()
                    7
                }
            }
            assertTrue(readerEntered.await(2, java.util.concurrent.TimeUnit.SECONDS))
            val diagnostic = pool.submit<Int> {
                DiagnosticReadCoordinator.diagnostic(timeoutMs = 2_000) {
                    diagnosticEntered.countDown()
                    DiagnosticReadCoordinator.normalRead { 9 }
                }
            }
            awaitReserved()
            expect<DiagnosticReadCoordinator.Busy> { DiagnosticReadCoordinator.normalRead { fail("new reader") } }
            assertEquals(1L, diagnosticEntered.count)
            nestNow.countDown()
            assertTrue(nested.await(2, java.util.concurrent.TimeUnit.SECONDS))
            assertEquals(1L, diagnosticEntered.count)
            releaseReader.countDown()
            assertEquals(7, reader.get(2, java.util.concurrent.TimeUnit.SECONDS))
            assertEquals(9, diagnostic.get(2, java.util.concurrent.TimeUnit.SECONDS))
        } finally {
            nestNow.countDown()
            releaseReader.countDown()
            pool.shutdownNow()
            pool.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
            awaitIdle()
        }
    }

    @Test
    fun stalledExistingReaderProducesBusyWithoutStartingDiagnostic() {
        DiagnosticReadCoordinator.normalRead {
            val pool = java.util.concurrent.Executors.newSingleThreadExecutor()
            try {
                val failure = pool.submit<Throwable> {
                    expect<DiagnosticReadCoordinator.Busy> {
                        DiagnosticReadCoordinator.diagnostic(timeoutMs = 10) { fail("must not run") }
                    }
                }
                assertTrue(failure.get(2, java.util.concurrent.TimeUnit.SECONDS) is DiagnosticReadCoordinator.Busy)
                assertFalse(DiagnosticReadCoordinator.isDiagnosticRunning)
            } finally { pool.shutdownNow() }
        }
        assertEquals(1, DiagnosticReadCoordinator.diagnostic { 1 })
    }

    @Test
    fun interruptionWhileDrainingRestoresInterruptAndReleasesReservation() {
        val interrupted = java.util.concurrent.ArrayBlockingQueue<Boolean>(1)
        val caller = Thread {
            try {
                DiagnosticReadCoordinator.diagnostic { fail("must not run") }
            } catch (_: InterruptedException) {
                interrupted.add(Thread.currentThread().isInterrupted)
            }
        }
        DiagnosticReadCoordinator.normalRead {
            caller.start()
            awaitReserved()
            caller.interrupt()
            assertEquals(true, interrupted.poll(2, java.util.concurrent.TimeUnit.SECONDS))
            caller.join(2_000)
            assertFalse(DiagnosticReadCoordinator.isDiagnosticRunning)
        }
    }

    @Test
    fun diagnosticFailuresPropagateWithoutFallbackAndReleaseAdmission() {
        val failure = IllegalStateException("no tree")
        assertSame(failure, expect<IllegalStateException> { DiagnosticReadCoordinator.diagnostic<Unit> { throw failure } })
        assertFalse(DiagnosticReadCoordinator.isDiagnosticRunning)
        assertEquals(3, DiagnosticReadCoordinator.normalRead { 3 })
        expect<DiagnosticReadCoordinator.Busy> {
            DiagnosticReadCoordinator.normalRead { DiagnosticReadCoordinator.diagnostic { fail("upgrade") } }
        }
        expect<IllegalArgumentException> { DiagnosticReadCoordinator.diagnostic(timeoutMs = 0) { fail("invalid") } }
    }

    private fun awaitReserved() {
        val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(2)
        while (!DiagnosticReadCoordinator.isDiagnosticRunning && System.nanoTime() < deadline) Thread.yield()
        assertTrue("diagnostic did not reserve admission", DiagnosticReadCoordinator.isDiagnosticRunning)
    }

    private fun awaitIdle() {
        val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(2)
        while (DiagnosticReadCoordinator.isDiagnosticRunning && System.nanoTime() < deadline) Thread.yield()
        assertFalse("worker did not release reservation", DiagnosticReadCoordinator.isDiagnosticRunning)
    }

    private inline fun <reified T : Throwable> expect(block: () -> Unit): T {
        try { block() } catch (failure: Throwable) {
            if (failure is T) return failure
            throw failure
        }
        throw AssertionError("expected ${T::class.java.simpleName}")
    }

    @Test
    fun diagnosticsReuseOneBoundedWorkerAndRunAwayFromCaller() {
        val first = DiagnosticReadCoordinator.diagnostic { Thread.currentThread() }
        val second = DiagnosticReadCoordinator.diagnostic { Thread.currentThread() }
        assertNotSame(Thread.currentThread(), first)
        assertSame(first, second)
    }

    @Test
    fun ordinaryReadsShareAdmissionAcrossThreads() {
        val entered = java.util.concurrent.CountDownLatch(2)
        val release = java.util.concurrent.CountDownLatch(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val reads = (1..2).map { pool.submit<Int> {
                DiagnosticReadCoordinator.normalRead {
                    entered.countDown()
                    release.await()
                    it
                }
            } }
            assertTrue("normal reads were serialized", entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
            release.countDown()
            assertEquals(listOf(1, 2), reads.map { it.get(2, java.util.concurrent.TimeUnit.SECONDS) })
        } finally {
            release.countDown()
            pool.shutdownNow()
            pool.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
        }
    }

    @Test
    fun interruptedCallerCannotReleaseOrCancelRunningWorker() {
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val interrupted = java.util.concurrent.ArrayBlockingQueue<Boolean>(1)
        val caller = Thread {
            try {
                DiagnosticReadCoordinator.diagnostic {
                    entered.countDown()
                    release.await()
                }
            } catch (_: InterruptedException) {
                interrupted.add(Thread.currentThread().isInterrupted)
            }
        }
        try {
            caller.start()
            assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
            caller.interrupt()
            assertEquals(true, interrupted.poll(2, java.util.concurrent.TimeUnit.SECONDS))
            assertTrue(DiagnosticReadCoordinator.isDiagnosticRunning)
            expect<DiagnosticReadCoordinator.Busy> { DiagnosticReadCoordinator.diagnostic { fail("second worker") } }
        } finally {
            release.countDown()
            caller.join(2_000)
            awaitIdle()
        }
    }

    @Test
    fun nestedNormalReadsReturnTheirResultAndReleaseAfterFailure() {
        assertEquals(42, DiagnosticReadCoordinator.normalRead {
            DiagnosticReadCoordinator.normalRead { 42 }
        })
        try {
            DiagnosticReadCoordinator.normalRead<Unit> { throw IllegalArgumentException("read failed") }
        } catch (_: IllegalArgumentException) {
            // The next diagnostic must not inherit an abandoned reader.
        }
        assertEquals("fresh", DiagnosticReadCoordinator.diagnostic { "fresh" })
    }
}
