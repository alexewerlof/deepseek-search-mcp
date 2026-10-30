import { timingSafeEqual } from 'node:crypto'
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server'
import { AUTH_CLIENT_ID, AUTH_TOKEN_LIFETIME_SECONDS } from './constants.ts'

/**
 * A verifier for one shared bearer token.
 *
 * This server issues no tokens: it compares the presented value against the
 * one the operator configured, in constant time, and reports the result as an
 * `AuthInfo` the SDK can attach to the request. Swapping in a real OAuth
 * verifier later means replacing this function, not the transport.
 */
export function createStaticTokenVerifier(expectedToken: string): OAuthTokenVerifier {
    const expected = Buffer.from(expectedToken, 'utf8')

    return {
        async verifyAccessToken(token: string): Promise<AuthInfo> {
            if (!matches(expected, Buffer.from(token, 'utf8'))) {
                throw new OAuthError(OAuthErrorCode.InvalidToken, 'The bearer token is not valid for this server.')
            }

            return {
                token,
                clientId: AUTH_CLIENT_ID,
                scopes: [],
                // The SDK rejects a token whose expiry is unset, so a static one
                // still needs a timestamp.
                expiresAt: Math.floor(Date.now() / 1000) + AUTH_TOKEN_LIFETIME_SECONDS,
            }
        },
    }
}

function matches(expected: Buffer, received: Buffer): boolean {
    if (expected.length !== received.length) return false
    return timingSafeEqual(expected, received)
}
