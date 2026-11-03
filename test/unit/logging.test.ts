import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLogger, describeBlock, diagnoseRequest } from '../../src/logging.ts'

describe('createLogger', () => {
    it('prefixes every line with the server name', () => {
        const lines: string[] = []
        const logger = createLogger('info', (line) => lines.push(line))

        logger.info('hello')

        assert.deepEqual(lines, ['[deepseek-search-mcp] hello'])
    })

    it('keeps debug lines out of the info level', () => {
        const lines: string[] = []
        const logger = createLogger('info', (line) => lines.push(line))

        logger.debug('detail')
        logger.info('summary')

        assert.deepEqual(lines, ['[deepseek-search-mcp] summary'])
    })

    it('writes nothing at all when off', () => {
        const lines: string[] = []
        const logger = createLogger('off', (line) => lines.push(line))

        logger.error('boom')
        logger.info('summary')
        logger.debug('detail')

        assert.deepEqual(lines, [])
    })
})

const ENDPOINT = { path: '/mcp', endpointPath: '/mcp', blocked: false }

describe('diagnoseRequest', () => {
    it('reports a disabled check when no token is configured', () => {
        const result = diagnoseRequest({ ...ENDPOINT, authorization: undefined, required: false, status: 200 })

        assert.equal(result.outcome, 'disabled')
    })

    it('reports a missing header and shows the expected shape', () => {
        const result = diagnoseRequest({ ...ENDPOINT, authorization: undefined, required: true, status: 401 })

        assert.equal(result.outcome, 'none')
        assert.match(result.hint ?? '', /Authorization: Bearer/)
    })

    it('reports a header without the Bearer scheme', () => {
        const result = diagnoseRequest({
            ...ENDPOINT,
            authorization: 'integration-token-0123456789abcdef',
            required: true,
            status: 401,
        })

        assert.equal(result.outcome, 'malformed')
    })

    it('accepts a bearer header on a successful request', () => {
        const result = diagnoseRequest({ ...ENDPOINT, authorization: 'Bearer any-value', required: true, status: 200 })

        assert.equal(result.outcome, 'accepted')
    })

    it('reports a rejected token without echoing it', () => {
        const presented = 'a-very-secret-value'
        const result = diagnoseRequest({
            ...ENDPOINT,
            authorization: `Bearer ${presented}`,
            required: true,
            status: 401,
        })

        assert.equal(result.outcome, 'rejected')
        assert.match(result.reason ?? '', /MCP_AUTH_TOKEN/)
        assert.ok(!JSON.stringify(result).includes(presented))
    })

    it('reports a request a guard answered first', () => {
        const result = diagnoseRequest({
            ...ENDPOINT,
            authorization: 'Bearer any-value',
            required: true,
            blocked: true,
            status: 403,
        })

        assert.equal(result.outcome, 'not-checked')
        assert.equal(result.reason, undefined)
    })

    it('reports a request sent to the wrong path', () => {
        const result = diagnoseRequest({
            path: '/',
            endpointPath: '/mcp',
            authorization: 'Bearer any-value',
            required: true,
            blocked: false,
            status: 404,
        })

        assert.equal(result.outcome, 'not-checked')
        assert.match(result.reason ?? '', /went to \//)
        assert.match(result.hint ?? '', /POST to \/mcp/)
    })

    it('reports the wrong path even when no token is configured', () => {
        const result = diagnoseRequest({
            path: '/',
            endpointPath: '/mcp',
            authorization: undefined,
            required: false,
            blocked: false,
            status: 404,
        })

        assert.equal(result.outcome, 'not-checked')
        assert.match(result.hint ?? '', /POST to \/mcp/)
    })

    it('treats a trailing slash as the same endpoint', () => {
        const result = diagnoseRequest({
            path: '/mcp/',
            endpointPath: '/mcp',
            authorization: 'Bearer any-value',
            required: true,
            blocked: false,
            status: 200,
        })

        assert.equal(result.outcome, 'accepted')
    })

    it('does not blame the token for an unrelated failure status', () => {
        const result = diagnoseRequest({ ...ENDPOINT, authorization: 'Bearer any-value', required: true, status: 500 })

        assert.equal(result.outcome, 'unknown')
    })
})

const LOCAL_ONLY = { host: ['localhost'], origin: ['localhost'] }

describe('describeBlock', () => {
    it('says nothing about statuses other than 403', () => {
        const result = describeBlock({ status: 200, host: 'attacker.example', origin: undefined, limits: LOCAL_ONLY })

        assert.equal(result.blocked, undefined)
    })

    it('attributes a foreign Host to the host guard and names the setting', () => {
        const result = describeBlock({
            status: 403,
            host: 'attacker.example:8765',
            origin: undefined,
            limits: LOCAL_ONLY,
        })

        assert.equal(result.blocked, 'host')
        assert.match(result.reason ?? '', /Invalid Host: attacker\.example/)
        assert.match(result.hint ?? '', /MCP_ALLOWED_HOSTS/)
        assert.match(result.hint ?? '', /attacker\.example/)
    })

    it('attributes a browser extension origin to the origin guard', () => {
        const result = describeBlock({
            status: 403,
            host: 'localhost:8765',
            origin: 'chrome-extension://abcdef',
            limits: LOCAL_ONLY,
        })

        assert.equal(result.blocked, 'origin')
        assert.match(result.reason ?? '', /Invalid Origin: abcdef/)
        assert.match(result.hint ?? '', /MCP_ALLOWED_ORIGINS/)
        assert.match(result.hint ?? '', /chrome-extension:\/\/\*/)
    })

    it('offers generic advice for an origin that cannot be parsed', () => {
        const result = describeBlock({ status: 403, host: 'localhost:8765', origin: 'null', limits: LOCAL_ONLY })

        assert.equal(result.blocked, 'origin')
        assert.match(result.hint ?? '', /<scheme>:\/\/\*/)
    })

    it('passes an origin covered by a scheme wildcard', () => {
        const result = describeBlock({
            status: 403,
            host: 'localhost:8765',
            origin: 'chrome-extension://abcdef',
            limits: { host: ['localhost'], origin: ['chrome-extension://*'] },
        })

        assert.equal(result.blocked, undefined)
    })

    it('blames nothing when a guard is not installed', () => {
        const result = describeBlock({
            status: 403,
            host: 'attacker.example',
            origin: 'chrome-extension://abcdef',
            limits: { host: undefined, origin: undefined },
        })

        assert.equal(result.blocked, undefined)
    })
})
