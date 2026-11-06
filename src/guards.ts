import type { RequestHandler, Response } from 'express'
import { validateHostHeader, validateOriginHeader } from '@modelcontextprotocol/server'
import { ENV_VARS } from './constants.ts'

/**
 * The two DNS-rebinding guards, and the messages they produce.
 *
 * The MCP specification makes `Origin` validation mandatory for Streamable HTTP
 * and says nothing about `Host`, so the origin guard is always installed here and
 * the host guard is best-effort. Both reuse the SDK's own validators, so the
 * decision to reject and the explanation of the rejection cannot disagree.
 */

/** Which guard ended the request. `undefined` means the 403 came from elsewhere. */
export type BlockedGuard = 'host' | 'origin'

/**
 * The allowlists the guards enforce. `undefined` means that guard is not
 * installed, so nothing is checked and nothing can be blamed on it.
 */
export type GuardLimits = {
    host: string[] | undefined
    origin: string[] | undefined
}

export type BlockDiagnosis = {
    /** What the guard rejected, in its own words. Never contains the token. */
    reason?: string
    /** The one setting, or client change, that fixes it. */
    hint?: string
    blocked: BlockedGuard | undefined
}

const FORBIDDEN_STATUS = 403
/** The JSON-RPC server-error code the MCP SDK guards use for a rejected request. */
const REJECTION_CODE = -32_000

/**
 * Rejects with a JSON-RPC error that names the failed check, the setting that
 * controls it and the value the client sent, so a client can report a useful
 * message without access to this server's stderr.
 */
function reject(res: Response, check: BlockedGuard, message: string, hint: string, value: string): void {
    res.status(FORBIDDEN_STATUS).json({
        jsonrpc: '2.0',
        id: null,
        error: {
            code: REJECTION_CODE,
            message,
            data: { check, setting: settingFor(check), value, hint },
        },
    })
}

function settingFor(check: BlockedGuard): string {
    return check === 'host' ? ENV_VARS.mcpAllowedHosts : ENV_VARS.mcpAllowedOrigins
}

/** Rejects a request whose `Host` header is not in `allowed`. Port-agnostic. */
export function createHostGuard(allowed: string[]): RequestHandler {
    return (req, res, next) => {
        const host = req.headers.host
        const result = validateHostHeader(host, allowed)
        if (result.ok) return next()

        reject(res, 'host', result.message, describeHostHint(host, allowed), parseHostname(host) ?? host ?? '')
    }
}

/** Rejects a browser request whose `Origin` is not in `allowed`. */
export function createOriginGuard(allowed: string[]): RequestHandler {
    return (req, res, next) => {
        const origin = req.headers.origin
        const result = validateOriginHeader(origin, allowed)
        if (result.ok) return next()

        reject(res, 'origin', result.message, describeOriginHint(origin, allowed), origin ?? '')
    }
}

/**
 * Attributes a 403 to the guard that produced it by re-running the SDK's own
 * validators. Nothing is duplicated here: when this says the `Host` header was
 * rejected, that is the same predicate that wrote the response.
 */
export function describeBlock(options: {
    status: number
    host: string | undefined
    origin: string | undefined
    limits: GuardLimits
}): BlockDiagnosis {
    const { status, host, origin, limits } = options
    if (status !== FORBIDDEN_STATUS) return { blocked: undefined }

    if (limits.host !== undefined) {
        const result = validateHostHeader(host, limits.host)
        if (!result.ok) {
            return { blocked: 'host', reason: result.message, hint: describeHostHint(host, limits.host) }
        }
    }

    if (limits.origin !== undefined) {
        const result = validateOriginHeader(origin, limits.origin)
        if (!result.ok) {
            return { blocked: 'origin', reason: result.message, hint: describeOriginHint(origin, limits.origin) }
        }
    }

    return { blocked: undefined }
}

function describeHostHint(host: string | undefined, allowed: string[]): string {
    const name = parseHostname(host) ?? 'the client hostname'
    return `add ${name} to ${ENV_VARS.mcpAllowedHosts}, or set ${ENV_VARS.mcpAllowedHosts}=* to disable this check (currently ${describeList(allowed)})`
}

function describeOriginHint(origin: string | undefined, allowed: string[]): string {
    const parsed = parseUrl(origin)
    if (parsed === undefined) {
        // An opaque origin -- the literal `null` from a sandboxed page, or a
        // `file://` document -- has no hostname, so no allowlist entry can ever
        // match it. Say that plainly instead of suggesting a value.
        return `the Origin "${origin ?? ''}" cannot be allowlisted; call the endpoint from the client's own process, or from a page served over http(s) and listed in ${ENV_VARS.mcpAllowedOrigins} (currently ${describeList(allowed)})`
    }

    // The SDK honours `<scheme>://*` only for non-http schemes: an `https://*`
    // entry matches nothing, so it must not be suggested.
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `add ${parsed.hostname} to ${ENV_VARS.mcpAllowedOrigins} (currently ${describeList(allowed)})`
    }

    return `add ${parsed.hostname} to ${ENV_VARS.mcpAllowedOrigins}, or ${parsed.protocol}//* for every origin of that scheme (currently ${describeList(allowed)})`
}

function describeList(allowed: string[]): string {
    return allowed.join(',')
}

/**
 * `Host` has no scheme, so it is parsed the way the SDK parses it: as the
 * authority of a synthetic URL. A missing header yields nothing to suggest.
 */
function parseHostname(host: string | undefined): string | undefined {
    if (host === undefined) return undefined
    return parseUrl(`http://${host}`)?.hostname
}

function parseUrl(value: string | undefined): URL | undefined {
    if (value === undefined || value === '') return undefined

    try {
        const url = new URL(value)
        return url.hostname === '' ? undefined : url
    } catch {
        return undefined
    }
}
