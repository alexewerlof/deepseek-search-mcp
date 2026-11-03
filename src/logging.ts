import { validateHostHeader, validateOriginHeader } from '@modelcontextprotocol/server'
import { DEFAULT_LOG_LEVEL, ENV_VARS, LOG_LEVELS, SERVER_NAME, type LogLevel } from './constants.ts'

/** Writes one already-formatted line. Defaults to stderr; tests inject a collector. */
export type LogSink = (line: string) => void

export type Logger = {
    readonly level: LogLevel
    /** Errors and one summary per request. Suppressed only by `off`. */
    error: (message: string) => void
    info: (message: string) => void
    /** Request detail: the headers a client sent, and why a request was rejected. */
    debug: (message: string) => void
}

const VERBOSITY: Record<LogLevel, number> = { off: 0, info: 1, debug: 2 }

/**
 * Builds a logger that writes to stderr, never stdout: stdout carries protocol
 * data once a stdio transport exists, and container logs must stay parseable.
 */
export function createLogger(level: LogLevel = DEFAULT_LOG_LEVEL, sink: LogSink = console.error): Logger {
    return {
        level,
        error: (message) => write(level, 'info', sink, message),
        info: (message) => write(level, 'info', sink, message),
        debug: (message) => write(level, 'debug', sink, message),
    }
}

export function isLogLevel(value: string): value is LogLevel {
    return (LOG_LEVELS as readonly string[]).includes(value)
}

function write(level: LogLevel, required: Exclude<LogLevel, 'off'>, sink: LogSink, message: string): void {
    if (VERBOSITY[level] < VERBOSITY[required]) return
    sink(`[${SERVER_NAME}] ${message}`)
}

const FIRST_ERROR_STATUS = 400
const UNAUTHORIZED_STATUS = 401
const FORBIDDEN_STATUS = 403
const BEARER_TOKEN = /^Bearer\s+\S+/i

/** How the bearer token check ended, as far as the server can tell. */
export type AuthOutcome = 'disabled' | 'not-checked' | 'none' | 'malformed' | 'rejected' | 'accepted' | 'unknown'

export type Diagnosis = {
    /** What the guard rejected, in its own words. Never contains the token. */
    reason?: string
    /** The one setting, or client change, that fixes it. */
    hint?: string
}

export type AuthDiagnosis = Diagnosis & { outcome: AuthOutcome }

/**
 * Explains how the bearer check ended, from the path the request took and what
 * it carried. The near misses matter more than the success: a token that is
 * present but wrong is a different bug from a missing header, a missing `Bearer`
 * prefix, a request sent to the wrong path, and a request a guard rejected first.
 * Only a `401` proves the token itself was refused.
 */
export function diagnoseRequest(options: {
    path: string
    endpointPath: string
    authorization: string | undefined
    required: boolean
    /** A `Host` or `Origin` guard answered before the bearer check could run. */
    blocked: boolean
    status: number
}): AuthDiagnosis {
    const { path, endpointPath, authorization, required, blocked, status } = options
    if (blocked) return { outcome: 'not-checked' }

    // Checked before the token, so a client pointed at the wrong URL is told
    // that, rather than being told the server wants no token.
    if (!samePath(path, endpointPath)) {
        return {
            outcome: 'not-checked',
            reason: `the request went to ${path}, not the MCP endpoint`,
            hint: `POST to ${endpointPath}`,
        }
    }

    if (!required) return { outcome: 'disabled' }

    if (authorization === undefined || authorization.trim() === '') {
        return {
            outcome: 'none',
            reason: 'no Authorization header was sent',
            hint: `send "Authorization: Bearer <${ENV_VARS.mcpAuthToken}>"`,
        }
    }

    if (!BEARER_TOKEN.test(authorization)) {
        return {
            outcome: 'malformed',
            reason: 'the Authorization header is not a Bearer token',
            hint: 'prefix the token with "Bearer "',
        }
    }

    if (status === UNAUTHORIZED_STATUS) {
        return {
            outcome: 'rejected',
            reason: `the bearer token does not match ${ENV_VARS.mcpAuthToken}`,
            hint: 'make the client send the same token this server was started with',
        }
    }

    if (status < FIRST_ERROR_STATUS) return { outcome: 'accepted' }

    // A different failure: the header was syntactically fine and this status is
    // not one the bearer gate produces, so the token was not the cause.
    return { outcome: 'unknown' }
}

/** `/mcp`, `/mcp/` and a configured trailing slash all name the same endpoint. */
function samePath(path: string, endpointPath: string): boolean {
    return trimTrailingSlashes(path) === trimTrailingSlashes(endpointPath)
}

function trimTrailingSlashes(path: string): string {
    return path.replace(/\/+$/, '') || '/'
}

/** Which SDK guard ended the request. `undefined` means the 403 came from elsewhere. */
export type BlockedGuard = 'host' | 'origin'

/**
 * The allowlists the SDK guards enforce. `undefined` means that guard was not
 * installed, so nothing is checked and nothing can be blamed on it.
 */
export type GuardLimits = {
    host: string[] | undefined
    origin: string[] | undefined
}

export type BlockDiagnosis = Diagnosis & { blocked: BlockedGuard | undefined }

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
            return { blocked: 'origin', reason: result.message, hint: describeOriginHint(origin) }
        }
    }

    return { blocked: undefined }
}

function describeHostHint(host: string | undefined, allowed: string[]): string {
    const hostname = parseHostname(host)
    const name = hostname ?? 'the client hostname'
    return `add ${name} to ${ENV_VARS.mcpAllowedHosts} (currently ${allowed.join(',')})`
}

function describeOriginHint(origin: string | undefined): string {
    const parsed = parseUrl(origin)
    if (parsed === undefined) {
        return `list the origin hostname in ${ENV_VARS.mcpAllowedOrigins}, or its scheme as <scheme>://*`
    }

    const schemeWildcard = `${parsed.protocol}//*`
    return `add ${parsed.hostname} to ${ENV_VARS.mcpAllowedOrigins}, or ${schemeWildcard} for every origin of that scheme`
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
