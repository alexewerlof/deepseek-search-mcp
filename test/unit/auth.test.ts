import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server'
import { createStaticTokenVerifier } from '../../src/auth.ts'

const TOKEN = 'test-token-0123456789abcdefghijkl'

describe('createStaticTokenVerifier', () => {
    it('accepts the configured token and reports a caller identity', async () => {
        const verifier = createStaticTokenVerifier(TOKEN)
        const info = await verifier.verifyAccessToken(TOKEN)

        assert.equal(info.token, TOKEN)
        assert.equal(info.clientId, 'lm-studio')
        assert.deepEqual(info.scopes, [])
        assert.ok(info.expiresAt !== undefined)
        assert.ok(info.expiresAt > Math.floor(Date.now() / 1000))
    })

    it('rejects a different token', async () => {
        const verifier = createStaticTokenVerifier(TOKEN)
        await assert.rejects(
            () => verifier.verifyAccessToken('test-token-0123456789abcdefghijklX'),
            (error: unknown) => {
                assert.ok(error instanceof OAuthError)
                assert.equal(error.code, OAuthErrorCode.InvalidToken)
                return true
            },
        )
    })

    it('rejects a token of a different length', async () => {
        const verifier = createStaticTokenVerifier(TOKEN)
        await assert.rejects(() => verifier.verifyAccessToken('short'), OAuthError)
    })

    it('rejects an empty token', async () => {
        const verifier = createStaticTokenVerifier(TOKEN)
        await assert.rejects(() => verifier.verifyAccessToken(''), OAuthError)
    })
})
