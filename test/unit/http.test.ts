import assert from 'node:assert/strict'
import { request } from 'node:http'
import { describe, it } from 'node:test'
import type { ServerConfig } from '../../src/config.ts'
import type { DeepSeekSearchAndFetch } from '../../src/deepseek/client.ts'
import { startHttpServer } from '../../src/http.ts'

const TOKEN = 'integration-token-0123456789abcdef'
const JSON_RPC_HEADERS = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
}

const stubClient: DeepSeekSearchAndFetch = {
    search: async () => ({ results: [] }),
    fetchPage: async () => ({ title: '', content: '' }),
}

function createConfig(): ServerConfig {
    return {
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
            allowedOrigins: undefined,
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

/** `fetch` strips the `Host` header, so DNS rebinding checks need a raw request. */
function postWithHostHeader(url: string, hostHeader: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        const outgoing = request(
            url,
            {
                method: 'POST',
                headers: {
                    ...JSON_RPC_HEADERS,
                    authorization: `Bearer ${TOKEN}`,
                    host: hostHeader,
                    'content-length': String(Buffer.byteLength(payload)),
                },
            },
            (incoming) => {
                incoming.resume()
                incoming.on('end', () => resolve(incoming.statusCode ?? 0))
            },
        )

        outgoing.on('error', reject)
        outgoing.end(payload)
    })
}

describe('HTTP endpoint', () => {
    it('rejects requests without a bearer token', async (t) => {
        const config = createConfig()
        const server = await startHttpServer(config, {
            client: stubClient,
            search: config.deepseek.search,
            fetch: config.deepseek.fetch,
        })
        t.after(() => server.close())

        const response = await fetch(server.url, toolsListRequest())

        assert.equal(response.status, 401)
        assert.match(response.headers.get('www-authenticate') ?? '', /Bearer/)
    })

    it('rejects a wrong bearer token', async (t) => {
        const config = createConfig()
        const server = await startHttpServer(config, {
            client: stubClient,
            search: config.deepseek.search,
            fetch: config.deepseek.fetch,
        })
        t.after(() => server.close())

        const response = await fetch(
            server.url,
            toolsListRequest({ authorization: 'Bearer wrong-but-long-enough-token-value' }),
        )

        assert.equal(response.status, 401)
    })

    it('serves tools/list for a valid token', async (t) => {
        const config = createConfig()
        const server = await startHttpServer(config, {
            client: stubClient,
            search: config.deepseek.search,
            fetch: config.deepseek.fetch,
        })
        t.after(() => server.close())

        const response = await fetch(server.url, toolsListRequest({ authorization: `Bearer ${TOKEN}` }))

        assert.equal(response.status, 200)
        const serialized = JSON.stringify(await readRpcPayload(response))

        assert.match(serialized, /deepseek_search/)
        assert.match(serialized, /deepseek_fetch/)
    })

    it('rejects a foreign Host header', async (t) => {
        const config = createConfig()
        const server = await startHttpServer(config, {
            client: stubClient,
            search: config.deepseek.search,
            fetch: config.deepseek.fetch,
        })
        t.after(() => server.close())

        const status = await postWithHostHeader(server.url, 'attacker.example')

        assert.equal(status, 403)
    })
})
