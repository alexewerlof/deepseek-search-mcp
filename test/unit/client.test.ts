import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeepSeekClient, type DeepSeekClientOptions, type FetchLike } from '../../src/deepseek/client.ts'
import { DeepSeekApiError } from '../../src/deepseek/errors.ts'
import type { SearchResult } from '../../src/deepseek/schemas.ts'

const API_KEY = 'sk-test-key'
const TIMEOUT_NAME = 'TimeoutError'

const sampleResult: SearchResult = {
    rerank_score: 2.4,
    title: 'DeepSeek V4 released',
    url: 'https://example.com/deepseek-v4',
    snippet: 'Short summary.',
    summary: 'Longer summary intended for a model to read.',
    content: 'Full page content.',
    site_name: 'Example News',
    site_icon: 'https://example.com/favicon.ico',
    date: '2026-06-01T00:00:00+00:00',
    authority: 3,
}

type RecordedCall = {
    url: string
    init: RequestInit
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

function createClient(fetchImpl: FetchLike, overrides: Partial<DeepSeekClientOptions> = {}): DeepSeekClient {
    return new DeepSeekClient({
        apiKey: API_KEY,
        baseUrl: 'https://api.deepseek.com',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetch: fetchImpl,
        sleep: async () => {},
        random: () => 0,
        ...overrides,
    })
}

function recordingFetch(responses: Array<() => Response>): { fetch: FetchLike; calls: RecordedCall[] } {
    const calls: RecordedCall[] = []

    return {
        calls,
        fetch: async (url, init) => {
            calls.push({ url, init })
            const next = responses.shift()
            assert.ok(next !== undefined, 'the client made more requests than the test provided responses for')
            return next()
        },
    }
}

function readBody(init: RequestInit): unknown {
    assert.equal(typeof init.body, 'string')
    return JSON.parse(init.body as string)
}

describe('DeepSeekClient.search', () => {
    it('posts to the search endpoint with bearer auth and wire field names', async () => {
        const { fetch, calls } = recordingFetch([() => jsonResponse({ results: [sampleResult] })])
        const client = createClient(fetch, { baseUrl: 'https://api.deepseek.com/' })

        const response = await client.search({
            query: 'deepseek v4',
            count: 3,
            needContent: true,
            oriQuestion: 'what did deepseek release',
        })

        assert.equal(calls.length, 1)
        assert.equal(calls[0]?.url, 'https://api.deepseek.com/v1/tools/search')
        assert.equal(new Headers(calls[0]?.init.headers).get('authorization'), `Bearer ${API_KEY}`)
        assert.equal(new Headers(calls[0]?.init.headers).get('content-type'), 'application/json')
        assert.deepEqual(readBody(calls[0]?.init), {
            query: 'deepseek v4',
            count: 3,
            ori_question: 'what did deepseek release',
            need_content: true,
        })
        assert.equal(response.results.length, 1)
        assert.equal(response.results[0]?.title, sampleResult.title)
    })

    it('omits optional fields that were not requested', async () => {
        const { fetch, calls } = recordingFetch([() => jsonResponse({ results: [] })])
        const client = createClient(fetch)

        await client.search({ query: 'minimal' })

        assert.deepEqual(readBody(calls[0]?.init), { query: 'minimal' })
    })
})

describe('DeepSeekClient.fetchPage', () => {
    it('posts the url to the fetch endpoint', async () => {
        const { fetch, calls } = recordingFetch([() => jsonResponse({ title: 'Example', content: '# Hello' })])
        const client = createClient(fetch)

        const page = await client.fetchPage({ url: 'https://example.com' })

        assert.equal(calls[0]?.url, 'https://api.deepseek.com/v1/tools/fetch')
        assert.deepEqual(readBody(calls[0]?.init), { url: 'https://example.com' })
        assert.equal(page.title, 'Example')
        assert.equal(page.content, '# Hello')
    })
})

describe('DeepSeekClient retries', () => {
    it('retries a 429 and returns the later success', async () => {
        const { fetch, calls } = recordingFetch([
            () => jsonResponse({ error: { message: 'rate limited', code: 'rate_limit' } }, 429),
            () => jsonResponse({ results: [] }),
        ])
        const delays: number[] = []
        const client = createClient(fetch, { maxRetries: 1, sleep: async (ms) => void delays.push(ms) })

        await client.search({ query: 'retry me' })

        assert.equal(calls.length, 2)
        assert.deepEqual(delays, [500])
    })

    it('does not retry a 400', async () => {
        const { fetch, calls } = recordingFetch([
            () =>
                jsonResponse(
                    { error: { message: 'count must be between 1 and 50', code: 'invalid_request_error' } },
                    400,
                ),
        ])
        const client = createClient(fetch, { maxRetries: 3 })

        await assert.rejects(
            () => client.search({ query: 'bad' }),
            (error: unknown) => {
                assert.ok(error instanceof DeepSeekApiError)
                assert.equal(error.status, 400)
                assert.equal(error.retryable, false)
                assert.match(error.message, /count must be between/)
                return true
            },
        )
        assert.equal(calls.length, 1)
    })

    it('gives up after the configured number of retries', async () => {
        const { fetch, calls } = recordingFetch([
            () => jsonResponse({ error: { message: 'boom' } }, 500),
            () => jsonResponse({ error: { message: 'boom' } }, 500),
        ])
        const client = createClient(fetch, { maxRetries: 1 })

        await assert.rejects(() => client.search({ query: 'always fails' }), DeepSeekApiError)
        assert.equal(calls.length, 2)
    })

    it('marks transport failures as retryable and explains a timeout', async () => {
        const { fetch, calls } = recordingFetch([
            () => {
                throw new DOMException('The operation was aborted due to timeout', TIMEOUT_NAME)
            },
        ])
        const client = createClient(fetch, { timeoutMs: 1_000 })

        await assert.rejects(
            () => client.search({ query: 'slow' }),
            (error: unknown) => {
                assert.ok(error instanceof DeepSeekApiError)
                assert.equal(error.status, 0)
                assert.equal(error.retryable, true)
                assert.match(error.message, /timed out after 1000 ms/)
                return true
            },
        )
        assert.equal(calls.length, 1)
    })
})

describe('DeepSeekClient response validation', () => {
    it('rejects a body that is not JSON', async () => {
        const { fetch } = recordingFetch([() => new Response('<html>oops</html>', { status: 200 })])
        const client = createClient(fetch)

        await assert.rejects(
            () => client.search({ query: 'x' }),
            (error: unknown) => {
                assert.ok(error instanceof DeepSeekApiError)
                assert.equal(error.code, 'invalid_response')
                assert.equal(error.retryable, false)
                return true
            },
        )
    })

    it('rejects a body that does not match the schema', async () => {
        const { fetch } = recordingFetch([() => jsonResponse({ results: [{ title: 42 }] })])
        const client = createClient(fetch)

        await assert.rejects(
            () => client.search({ query: 'x' }),
            (error: unknown) => {
                assert.ok(error instanceof DeepSeekApiError)
                assert.equal(error.code, 'invalid_response')
                assert.match(error.message, /results\.0/)
                return true
            },
        )
    })
})
