import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigError, loadConfig, type ServerConfig } from '../../src/config.ts'
import { DeepSeekClient } from '../../src/deepseek/client.ts'
import { DeepSeekApiError } from '../../src/deepseek/errors.ts'

/**
 * Live checks: these call the real DeepSeek API and cost money per successful
 * request. They are only run by `npm run test:live`, and skip themselves when
 * no API key is configured.
 */
function tryLoadConfig(): ServerConfig | undefined {
    try {
        return loadConfig()
    } catch (error) {
        if (error instanceof ConfigError) return undefined
        throw error
    }
}

const liveConfig = tryLoadConfig()
const skipReason = liveConfig === undefined ? 'DEEPSEEK_API_KEY is not configured' : false

function createClient(config: ServerConfig): DeepSeekClient {
    return new DeepSeekClient({
        apiKey: config.deepseek.apiKey,
        baseUrl: config.deepseek.baseUrl,
        timeoutMs: config.deepseek.timeoutMs,
        maxRetries: config.deepseek.maxRetries,
    })
}

async function withLiveClient(run: (client: DeepSeekClient) => Promise<void>): Promise<void> {
    if (liveConfig === undefined) throw new Error('live configuration is unavailable')
    await run(createClient(liveConfig))
}

test('search returns at least one usable result', { skip: skipReason }, async () => {
    await withLiveClient(async (client) => {
        const response = await client.search({ query: 'DeepSeek API documentation', count: 3 })

        assert.ok(response.results.length > 0, 'expected at least one result')
        for (const result of response.results) {
            assert.match(result.url, /^https?:\/\//)
            assert.equal(typeof result.title, 'string')
        }
    })
})

test('fetch returns Markdown for a stable page', { skip: skipReason }, async () => {
    await withLiveClient(async (client) => {
        const page = await client.fetchPage({ url: 'https://example.com' })

        assert.ok(page.content.trim().length > 0, 'expected page content')
    })
})

test('an invalid key fails with 401 and is not retried', { skip: skipReason }, async () => {
    const invalid = new DeepSeekClient({
        apiKey: 'sk-invalid-key-for-testing',
        baseUrl: 'https://api.deepseek.com',
        timeoutMs: 15_000,
        maxRetries: 0,
    })

    await assert.rejects(
        () => invalid.search({ query: 'should fail' }),
        (error: unknown) => {
            assert.ok(error instanceof DeepSeekApiError)
            assert.equal(error.status, 401)
            assert.equal(error.retryable, false)
            return true
        },
    )
})
