import assert from 'node:assert/strict'
import { request } from 'node:http'
import { describe, it, type TestContext } from 'node:test'
import type { ServerConfig } from '../../src/config.ts'
import type { LogLevel } from '../../src/constants.ts'
import type { DeepSeekSearchAndFetch } from '../../src/deepseek/client.ts'
import { startHttpServer, type RunningHttpServer } from '../../src/http.ts'
import { createLogger, type Logger } from '../../src/logging.ts'

const TOKEN = 'integration-token-0123456789abcdef'
const JSON_RPC_HEADERS = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
}

const stubClient: DeepSeekSearchAndFetch = {
    search: async () => ({ results: [] }),
    fetchPage: async () => ({ title: '', content: '' }),
}

function createConfig(http: Partial<ServerConfig['http']> = {}): ServerConfig {
    return {
        logLevel: 'info',
        deepseek: {
            apiKey: 'sk-test',
            baseUrl: 'https://example.invalid',
            timeoutMs: 1_000,
            maxRetries: 0,
            search: { count: 5, contentChars: 200, textChars: 2_000 },
            fetch: { maxChars: 200 },
        },
        http: {
            host: '127.0.0.1',
            port: 0,
            path: '/mcp',
            authToken: TOKEN,
            allowedHosts: undefined,
            hostGuardOptOut: false,
            allowedOrigins: undefined,
            ...http,
        },
    }
}

function toolsListRequest(headers: Record<string, string> = {}): RequestInit {
    return {
        method: 'POST',
        headers: { ...JSON_RPC_HEADERS, ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }
}

async function startTestServer(
    t: TestContext,
    options: { config?: ServerConfig; logger?: Logger } = {},
): Promise<RunningHttpServer> {
    const config = options.config ?? createConfig()
    const server = await startHttpServer(config, {
        client: stubClient,
        search: config.deepseek.search,
        fetch: config.deepseek.fetch,
        logger: options.logger,
    })
    t.after(() => server.close())
    return server
}

/** A logger whose lines a test can inspect, with no dependency on `console`. */
function captureLogger(level: LogLevel): { logger: Logger; lines: string[] } {
    const lines: string[] = []
    return { logger: createLogger(level, (line) => lines.push(line)), lines }
}

const LOG_WAIT_MS = 1_000
const LOG_POLL_MS = 10

/**
 * The summary is written when the response ends, which can trail the moment the
 * client has read the last byte, so give the event loop a bounded chance first.
 */
async function waitForLine(lines: string[], matches: (line: string) => boolean): Promise<string> {
    const deadline = Date.now() + LOG_WAIT_MS
    while (Date.now() < deadline) {
        const found = lines.find(matches)
        if (found !== undefined) return found
        await new Promise((resolve) => setTimeout(resolve, LOG_POLL_MS))
    }

    assert.fail(`no matching log line; captured: ${lines.join(' | ') || '(none)'}`)
}

/**
 * The endpoint answers 2025-era clients with an SSE stream, which is what LM
 * Studio receives. Read either shape.
 */
async function readRpcPayload(response: Response): Promise<unknown> {
    const body = await response.text()
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) return JSON.parse(body)

    const dataLines = body.split('\n').filter((line) => line.startsWith('data:'))
    const last = dataLines[dataLines.length - 1]
    assert.ok(last !== undefined, 'the SSE response contained no data event')
    return JSON.parse(last.slice('data:'.length).trim())
}

/** The server binds `0.0.0.0` in some tests; dial it through loopback instead. */
function toLoopback(url: string): string {
    return url.replace('0.0.0.0', '127.0.0.1')
}

/** `fetch` strips the `Host` header, so DNS rebinding checks need a raw request. */
function postWithHeaders(url: string, headers: Record<string, string>): Promise<number> {
    return postForResponse(url, headers).then((response) => response.status)
}

/** The same raw request, keeping the body so a rejection can be inspected. */
function postForResponse(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        const outgoing = request(
            url,
            {
                method: 'POST',
                headers: {
                    ...JSON_RPC_HEADERS,
                    authorization: `Bearer ${TOKEN}`,
                    host: new URL(url).host,
                    'content-length': String(Buffer.byteLength(payload)),
                    ...headers,
                },
            },
            (incoming) => {
                const chunks: Buffer[] = []
                incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
                incoming.on('end', () =>
                    resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
                )
            },
        )

        outgoing.on('error', reject)
        outgoing.end(payload)
    })
}

describe('HTTP endpoint', () => {
    it('rejects requests without a bearer token', async (t) => {
        const server = await startTestServer(t)

        const response = await fetch(server.url, toolsListRequest())

        assert.equal(response.status, 401)
        assert.match(response.headers.get('www-authenticate') ?? '', /Bearer/)
    })

    it('rejects a wrong bearer token', async (t) => {
        const server = await startTestServer(t)

        const response = await fetch(
            server.url,
            toolsListRequest({ authorization: 'Bearer wrong-but-long-enough-token-value' }),
        )

        assert.equal(response.status, 401)
    })

    it('serves tools/list for a valid token', async (t) => {
        const server = await startTestServer(t)

        const response = await fetch(server.url, toolsListRequest({ authorization: `Bearer ${TOKEN}` }))

        assert.equal(response.status, 200)
        const serialized = JSON.stringify(await readRpcPayload(response))

        assert.match(serialized, /deepseek_search/)
        assert.match(serialized, /deepseek_fetch/)
    })

    it('rejects a foreign Host header', async (t) => {
        const server = await startTestServer(t)

        const status = await postWithHeaders(server.url, { host: 'attacker.example' })

        assert.equal(status, 403)
    })
})

describe('guard policy', () => {
    it('starts on a non-loopback bind without an explicit host list', async (t) => {
        const server = await startTestServer(t, { config: createConfig({ host: '0.0.0.0' }) })

        const response = await fetch(toLoopback(server.url), toolsListRequest({ authorization: `Bearer ${TOKEN}` }))

        assert.equal(response.status, 200)
        await response.text()
    })

    it('accepts any Host when no host list is configured', async (t) => {
        const server = await startTestServer(t, { config: createConfig({ host: '0.0.0.0' }) })

        const status = await postWithHeaders(toLoopback(server.url), { host: 'anything.example' })

        assert.equal(status, 200)
    })

    it('still checks Origin on a non-loopback bind with no configuration', async (t) => {
        const server = await startTestServer(t, { config: createConfig({ host: '0.0.0.0' }) })

        const { status, body } = await postForResponse(toLoopback(server.url), {
            origin: 'chrome-extension://abcdefghijklmnop',
        })

        assert.equal(status, 403)
        const payload = JSON.parse(body)
        assert.equal(payload.error.data.check, 'origin')
        assert.equal(payload.error.data.setting, 'MCP_ALLOWED_ORIGINS')
        assert.match(payload.error.data.hint, /chrome-extension:\/\/\*/)
    })

    it('names the host check in the rejection body', async (t) => {
        const server = await startTestServer(t)

        const { status, body } = await postForResponse(server.url, { host: 'attacker.example' })

        assert.equal(status, 403)
        const payload = JSON.parse(body)
        assert.equal(payload.error.data.check, 'host')
        assert.equal(payload.error.data.setting, 'MCP_ALLOWED_HOSTS')
        assert.match(payload.error.data.hint, /attacker\.example/)
    })

    it('accepts an extension origin covered by a scheme wildcard', async (t) => {
        const server = await startTestServer(t, {
            config: createConfig({ allowedOrigins: ['chrome-extension://*'] }),
        })

        const { status, body } = await postForResponse(server.url, {
            origin: 'chrome-extension://abcdefghijklmnop',
        })

        assert.equal(status, 200, body)
    })
})

describe('request logging', () => {
    it('records a successful request with the auth outcome', async (t) => {
        const capture = captureLogger('info')
        const server = await startTestServer(t, { logger: capture.logger })

        const response = await fetch(server.url, toolsListRequest({ authorization: `Bearer ${TOKEN}` }))
        await response.text()

        const summary = await waitForLine(capture.lines, (line) => line.includes('POST /mcp 200'))
        assert.match(summary, /auth=accepted/)
        assert.ok(!summary.includes('blocked='))
    })

    it('names the missing Authorization header', async (t) => {
        const capture = captureLogger('info')
        const server = await startTestServer(t, { logger: capture.logger })

        const response = await fetch(server.url, toolsListRequest())
        await response.text()

        const summary = await waitForLine(capture.lines, (line) => line.includes('POST /mcp 401'))
        assert.match(summary, /auth=none/)

        const reason = await waitForLine(capture.lines, (line) => line.includes('reason='))
        assert.match(reason, /Authorization/)
    })

    it('blames the host guard for a foreign Host header', async (t) => {
        const capture = captureLogger('info')
        const server = await startTestServer(t, { logger: capture.logger })

        const status = await postWithHeaders(server.url, { host: 'attacker.example' })
        assert.equal(status, 403)

        const summary = await waitForLine(capture.lines, (line) => line.includes(' 403 '))
        assert.match(summary, /blocked=host/)
        assert.match(summary, /auth=not-checked/)

        const hint = await waitForLine(capture.lines, (line) => line.includes('hint='))
        assert.match(hint, /MCP_ALLOWED_HOSTS/)
        assert.match(hint, /attacker\.example/)
    })

    it('blames the origin guard for a browser extension origin', async (t) => {
        const capture = captureLogger('info')
        const server = await startTestServer(t, { logger: capture.logger })

        const status = await postWithHeaders(server.url, { origin: 'chrome-extension://abcdefghijklmnop' })
        assert.equal(status, 403)

        const summary = await waitForLine(capture.lines, (line) => line.includes(' 403 '))
        assert.match(summary, /blocked=origin/)
        assert.match(summary, /auth=not-checked/)
        assert.match(summary, /origin=chrome-extension:\/\/abcdefghijklmnop/)

        const hint = await waitForLine(capture.lines, (line) => line.includes('hint='))
        assert.match(hint, /MCP_ALLOWED_ORIGINS/)
        assert.match(hint, /chrome-extension:\/\/\*/)
    })

    it('points out a request that missed the endpoint path', async (t) => {
        const capture = captureLogger('info')
        const server = await startTestServer(t, { logger: capture.logger })

        const status = await postWithHeaders(server.url.replace('/mcp', '/'), {})
        assert.equal(status, 404)

        const summary = await waitForLine(capture.lines, (line) => line.includes('POST / 404'))
        assert.match(summary, /auth=not-checked/)

        const hint = await waitForLine(capture.lines, (line) => line.includes('hint='))
        assert.match(hint, /POST to \/mcp/)
    })

    it('accepts an origin listed in MCP_ALLOWED_ORIGINS', async (t) => {
        const config = createConfig()
        config.http.allowedOrigins = ['chrome-extension://*']
        const capture = captureLogger('info')
        const server = await startTestServer(t, { config, logger: capture.logger })

        const response = await fetch(server.url, toolsListRequest({ authorization: `Bearer ${TOKEN}` }))
        await response.text()
        assert.equal(response.status, 200)

        const summary = await waitForLine(capture.lines, (line) => line.includes('POST /mcp 200'))
        assert.match(summary, /auth=accepted/)
        assert.ok(!summary.includes('blocked='))
    })

    it('prints the headers a client sent at debug level', async (t) => {
        const capture = captureLogger('debug')
        const server = await startTestServer(t, { logger: capture.logger })

        const response = await fetch(server.url, toolsListRequest({ authorization: `Bearer ${TOKEN}` }))
        await response.text()

        const line = await waitForLine(capture.lines, (entry) => entry.includes('received'))
        assert.match(line, /host=127\.0\.0\.1:\d+/)
        assert.match(line, /auth=present/)
        assert.match(line, /content-type=application\/json/)
    })

    it('writes nothing when the level is off', async (t) => {
        const capture = captureLogger('off')
        const server = await startTestServer(t, { logger: capture.logger })

        const response = await fetch(server.url, toolsListRequest({ authorization: `Bearer ${TOKEN}` }))
        await response.text()
        assert.equal(response.status, 200)

        assert.deepEqual(capture.lines, [])
    })

    it('never writes the bearer token to the log', async (t) => {
        const capture = captureLogger('debug')
        const server = await startTestServer(t, { logger: capture.logger })

        const response = await fetch(
            server.url,
            toolsListRequest({ authorization: 'Bearer wrong-but-long-enough-token-value' }),
        )
        await response.text()
        assert.equal(response.status, 401)

        await waitForLine(capture.lines, (line) => line.includes('POST /mcp 401'))
        for (const line of capture.lines) {
            assert.ok(!line.includes(TOKEN), `a log line leaked the token: ${line}`)
            assert.ok(!line.includes('wrong-but-long-enough-token-value'), `a log line leaked the token: ${line}`)
        }
    })
})
