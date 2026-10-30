import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConfigError, loadConfig, type ServerConfig } from '../../src/config.ts'

const VALID_TOKEN = 'a'.repeat(32)

/**
 * An address from the RFC 5737 documentation range (`198.51.100.0/24`), so no
 * test fixture ever contains a real host. Paired with the RFC 2606 reserved TLD
 * `.example` for the hostname.
 */
const LAN_HOST = '198.51.100.10'
const LAN_HOSTNAME = 'server.example'

/**
 * Runs `loadConfig` against an explicit environment. The real `process.env` and
 * the developer's `.env` are never read: Node's `--env-file` has already run by
 * the time this module loads, and `loadConfig` only ever sees the object below.
 */
function load(env: NodeJS.ProcessEnv): ServerConfig {
    return loadConfig({ env })
}

function expectConfigError(run: () => unknown, pattern: RegExp): void {
    assert.throws(run, (error: unknown) => {
        assert.ok(error instanceof ConfigError, `expected a ConfigError, got ${String(error)}`)
        assert.match(error.message, pattern)
        return true
    })
}

describe('loadConfig', () => {
    it('applies defaults when only the API key is set', () => {
        const config = load({ DEEPSEEK_API_KEY: 'sk-test' })

        assert.equal(config.deepseek.apiKey, 'sk-test')
        assert.equal(config.deepseek.baseUrl, 'https://api.deepseek.com')
        assert.equal(config.deepseek.timeoutMs, 30_000)
        assert.equal(config.deepseek.maxRetries, 2)
        assert.equal(config.deepseek.search.count, 5)
        assert.equal(config.deepseek.fetch.maxChars, 20_000)
        assert.equal(config.http.host, '127.0.0.1')
        assert.equal(config.http.port, 8765)
        assert.equal(config.http.path, '/mcp')
        assert.equal(config.http.authToken, undefined)
    })

    it('ignores blank values and keeps the default', () => {
        const config = load({ DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_BASE_URL: '   ' })
        assert.equal(config.deepseek.baseUrl, 'https://api.deepseek.com')
    })
})

describe('loadConfig validation', () => {
    it('names the missing API key variable', () => {
        expectConfigError(() => load({}), /DEEPSEEK_API_KEY/)
    })

    it('rejects a token shorter than the minimum length', () => {
        expectConfigError(() => load({ DEEPSEEK_API_KEY: 'sk-test', MCP_AUTH_TOKEN: 'short' }), /MCP_AUTH_TOKEN/)
    })

    it('refuses a non-loopback bind without a token', () => {
        expectConfigError(() => load({ DEEPSEEK_API_KEY: 'sk-test', MCP_HTTP_HOST: LAN_HOST }), /MCP_AUTH_TOKEN/)
    })

    it('refuses a non-loopback bind without allowed hostnames', () => {
        expectConfigError(
            () =>
                load({
                    DEEPSEEK_API_KEY: 'sk-test',
                    MCP_HTTP_HOST: LAN_HOST,
                    MCP_AUTH_TOKEN: VALID_TOKEN,
                }),
            /MCP_ALLOWED_HOSTS/,
        )
    })

    it('accepts a fully configured non-loopback bind and parses the lists', () => {
        const config = load({
            DEEPSEEK_API_KEY: 'sk-test',
            MCP_HTTP_HOST: LAN_HOST,
            MCP_AUTH_TOKEN: VALID_TOKEN,
            MCP_ALLOWED_HOSTS: `${LAN_HOST}, ${LAN_HOSTNAME}`,
            MCP_ALLOWED_ORIGINS: `http://${LAN_HOST}:3000`,
        })

        assert.equal(config.http.host, LAN_HOST)
        assert.deepEqual(config.http.allowedHosts, [LAN_HOST, LAN_HOSTNAME])
        assert.deepEqual(config.http.allowedOrigins, [`http://${LAN_HOST}:3000`])
    })

    it('rejects a port outside the valid range', () => {
        expectConfigError(() => load({ DEEPSEEK_API_KEY: 'sk-test', MCP_HTTP_PORT: '70000' }), /MCP_HTTP_PORT/)
    })

    it('rejects a non-integer retry count', () => {
        expectConfigError(
            () => load({ DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_MAX_RETRIES: 'lots' }),
            /DEEPSEEK_MAX_RETRIES/,
        )
    })

    it('rejects a search result count above the API maximum', () => {
        expectConfigError(
            () => load({ DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_SEARCH_MAX_RESULTS: '99' }),
            /DEEPSEEK_SEARCH_MAX_RESULTS/,
        )
    })
})
