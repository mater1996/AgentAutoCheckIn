package com.mobilerun.portal.service

import android.util.Log
import com.mobilerun.portal.api.ApiHandler
import com.mobilerun.portal.api.ApiResponse
import com.mobilerun.portal.config.ConfigManager
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

class SocketServerDiagnosticTest {
    @After
    fun tearDown() = unmockkAll()

    @Test
    fun diagnosticPostRequiresExistingBearerAuthentication() {
        val handler = mockk<ApiHandler>(relaxed = true)
        val response = request(handler, null)
        assertTrue(response.startsWith("HTTP/1.1 401"))
        verify(exactly = 0) { handler.diagnosticRead(any()) }
    }

    @Test
    fun authenticatedDiagnosticPostPreservesExplicitBooleanFalse() {
        val handler = mockk<ApiHandler>()
        every { handler.diagnosticRead(match { it.opt("filter") == false }) } returns
            ApiResponse.RawObject(org.json.JSONObject().put("requestId", "socket-test").put("complete", true))
        val response = request(handler, "test-secret")
        assertTrue(response.startsWith("HTTP/1.1 200"))
        assertTrue(response.contains("socket-test"))
        verify(exactly = 1) { handler.diagnosticRead(match { it.opt("filter") == false }) }
    }

    private fun request(handler: ApiHandler, token: String?): String {
        mockkStatic(Log::class)
        every { Log.e(any(), any(), any()) } returns 0
        val config = mockk<ConfigManager>()
        every { config.authToken } returns "test-secret"
        val server = SocketServer(handler, config, mockk(relaxed = true))
        val method = SocketServer::class.java.getDeclaredMethod("handleClient", Socket::class.java)
        method.isAccessible = true
        return ServerSocket(0).use { listener ->
            val worker = thread { listener.accept().use { method.invoke(server, it) } }
            val response = Socket("127.0.0.1", listener.localPort).use { client ->
                client.soTimeout = 3_000
                val body = """{"mode":"baseline","package":"com.example.target","filter":false,"requestId":"socket-test"}"""
                val auth = token?.let { "Authorization: Bearer $it\r\n" }.orEmpty()
                client.getOutputStream().write((
                    "POST /diagnostics/a11y/read HTTP/1.1\r\n" + auth +
                        "Content-Length: ${body.toByteArray().size}\r\n\r\n" + body
                    ).toByteArray())
                client.getOutputStream().flush()
                val reader = client.getInputStream().bufferedReader()
                val status = reader.readLine() ?: error("missing status")
                val headers = mutableListOf<String>()
                while (true) {
                    val line = reader.readLine() ?: error("truncated headers")
                    if (line.isEmpty()) break
                    headers += line
                }
                val length = headers.single { it.startsWith("Content-Length:", ignoreCase = true) }
                    .substringAfter(':').trim().toInt()
                val payload = CharArray(length)
                var read = 0
                while (read < length) {
                    val n = reader.read(payload, read, length - read)
                    check(n > 0) { "truncated body" }
                    read += n
                }
                status + "\r\n" + headers.joinToString("\r\n") + "\r\n\r\n" + String(payload)
            }
            worker.join(3_000)
            response
        }
    }
}
