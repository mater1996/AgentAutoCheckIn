package com.mobilerun.portal.api

import android.content.Context
import android.content.pm.PackageManager
import com.mobilerun.portal.core.DiagnosticReadCoordinator
import com.mobilerun.portal.core.StateRepository
import io.mockk.mockk
import io.mockk.verify
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class DiagnosticApiIntegrationTest {
    @Test
    fun diagnosticReadRejectsInvalidRequestBeforeAccessingService() {
        val repository = mockk<StateRepository>(relaxed = true)
        val handler = handler(repository)
        try {
            val result = handler.diagnosticRead(JSONObject()
                .put("mode", "baseline")
                .put("package", "com.example.target")
                .put("requestId", "invalid-filter")
                .put("filter", true))
            assertTrue(result is ApiResponse.Error)
            assertTrue((result as ApiResponse.Error).message.contains("filter"))
            verify(exactly = 0) { repository.diagnosticRead(any()) }
        } finally {
            handler.close()
        }
    }

    @Test
    fun normalApiReadRejectsBusyDiagnosticBeforeRepositoryAndCache() {
        val repository = mockk<StateRepository>(relaxed = true)
        val handler = handler(repository)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val worker = thread {
            DiagnosticReadCoordinator.diagnostic(timeoutMs = 5_000L) {
                entered.countDown()
                release.await(4, TimeUnit.SECONDS)
            }
        }
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            val result = handler.getStateFull(false)
            assertEquals(ApiResponse.Error("diagnostic_busy"), result)
            verify(exactly = 0) { repository.getFullTree(any()) }
        } finally {
            release.countDown()
            worker.join(3_000L)
            handler.close()
        }
    }

    private fun handler(repository: StateRepository) = ApiHandler(
        repository,
        { null },
        { mockk<PackageManager>(relaxed = true) },
        { "test" },
        mockk<Context>(relaxed = true),
    )
}
