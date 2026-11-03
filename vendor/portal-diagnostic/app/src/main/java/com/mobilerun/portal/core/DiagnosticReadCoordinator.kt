package com.mobilerun.portal.core

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Callable
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Process-wide admission for application-owned accessibility reads.
 * Normal entry never waits for a diagnostic; existing nested reads can finish.
 * A timed-out caller never cancels the worker or releases its reservation.
 */
object DiagnosticReadCoordinator {
    class Busy(message: String = "diagnostic read is busy") : IllegalStateException(message)
    class Timeout(message: String = "diagnostic read timed out; worker may still be running") : RuntimeException(message)

    private val monitor = Object()
    private val depth = ThreadLocal<Int>()
    private var readers = 0
    private var reserved = false
    // Admission permits one task; one queue slot covers the previous task's completion epilogue.
    private val executor = ThreadPoolExecutor(
        1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(1),
        { task -> Thread(task, "diagnostic-a11y-read").apply { isDaemon = true } },
    )

    val isDiagnosticRunning: Boolean get() = synchronized(monitor) { reserved }

    fun <T> normalRead(block: () -> T): T {
        val previous = depth.get() ?: 0
        if (previous == 0) synchronized(monitor) {
            if (reserved) throw Busy()
            readers++
        }
        depth.set(previous + 1)
        try {
            return block()
        } finally {
            if (previous == 0) {
                depth.remove()
                synchronized(monitor) {
                    readers--
                    monitor.notifyAll()
                }
            } else depth.set(previous)
        }
    }

    /** [timeoutMs] bounds admission draining plus waiting for the single worker's result. */
    fun <T> diagnostic(timeoutMs: Long = 10_000, block: () -> T): T {
        require(timeoutMs > 0) { "timeoutMs must be positive" }
        if ((depth.get() ?: 0) != 0) throw Busy("cannot diagnose from inside a node read")
        val started = System.nanoTime()
        val budget = TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        synchronized(monitor) {
            if (reserved) throw Busy()
            reserved = true
        }
        val task = FutureTask(Callable {
            depth.set(1) // A diagnostic owns exclusive admission; nested ordinary helpers are safe.
            try {
                block()
            } finally {
                depth.remove()
                release()
            }
        })
        try {
            synchronized(monitor) {
                while (readers != 0) {
                    val remaining = budget - (System.nanoTime() - started)
                    if (remaining <= 0) throw Busy("normal node reads did not finish within the diagnostic budget")
                    TimeUnit.NANOSECONDS.timedWait(monitor, remaining)
                }
            }
            executor.execute(task)
        } catch (failure: Throwable) {
            release() // Worker was never started, so this caller still owns the reservation.
            if (failure is InterruptedException) Thread.currentThread().interrupt()
            throw failure
        }
        return try {
            task.get((budget - (System.nanoTime() - started)).coerceAtLeast(0), TimeUnit.NANOSECONDS)
        } catch (_: TimeoutException) {
            throw Timeout()
        } catch (failure: ExecutionException) {
            throw (failure.cause ?: failure)
        } catch (failure: InterruptedException) {
            Thread.currentThread().interrupt()
            throw failure
        }
    }

    private fun release() = synchronized(monitor) {
        reserved = false
        monitor.notifyAll()
    }
}
