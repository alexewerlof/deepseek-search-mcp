import {
    DEFAULT_HTTP_HOST,
    DEFAULT_HTTP_PORT,
    DEFAULT_HTTP_PATH,
    DEFAULT_LOG_LEVEL,
    ENV_VARS,
    LOG_LEVELS,
    LOOPBACK_HOSTS,
    MIN_AUTH_TOKEN_LENGTH,
    LIST_WILDCARD,
    type LogLevel,
} from './constants.ts'
import {
    DEFAULT_BASE_URL,
    DEFAULT_FETCH_MAX_CHARS,
    DEFAULT_MAX_RETRIES,
    DEFAULT_SEARCH_CONTENT_CHARS,
    DEFAULT_SEARCH_COUNT,
    DEFAULT_SEARCH_TEXT_CHARS,
    DEFAULT_TIMEOUT_MS,
    MAX_OUTPUT_CAP,
    MAX_SEARCH_COUNT,
    MIN_SEARCH_COUNT,
} from './deepseek/constants.ts'
import { isLogLevel } from './logging.ts'
import type { FetchToolOptions } from './tools/fetch.ts'
import type { SearchToolOptions } from './tools/search.ts'

export type DeepSeekConfig = {
    apiKey: string
    baseUrl: string
    timeoutMs: number
    maxRetries: number
    search: SearchToolOptions
    fetch: FetchToolOptions
}

export type HttpConfig = {
    host: string
    port: number
    path: string
    authToken: string | undefined
    allowedHosts: string[] | undefined
    /** `MCP_ALLOWED_HOSTS=*`: the `Host` guard is off on purpose, not forgotten. */
    hostGuardOptOut: boolean
    allowedOrigins: string[] | undefined
}

export type ServerConfig = {
    deepseek: DeepSeekConfig
    http: HttpConfig
    logLevel: LogLevel
}

export type LoadConfigOptions = {
    /** Defaults to `process.env`; tests pass an explicit object. */
    env?: NodeJS.ProcessEnv
}

export class ConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ConfigError'
    }
}

const MIN_PORT = 0
const MAX_PORT = 65_535
const MIN_RETRIES = 0
const MAX_RETRIES = 5
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 120_000

/** `<scheme>://*`, the only wildcard form the SDK's origin guard honours. */
const SCHEME_WILDCARD = /^([a-z][a-z0-9+.-]*):\/\/\*$/i

/** What a browser sends for an opaque context; no allowlist entry can match it. */
const OPAQUE_ORIGIN = 'null'

/** `server.example:8765` — a hostname entry never includes the port. */
const HOST_WITH_PORT = /^[^:\s/[\]]*:\d+$/

/**
 * Builds the server configuration from environment variables. The `.env` file is
 * not read here: `npm start` passes `--env-file-if-exists=.env`, and Node loads it
 * before this module runs. Throws a `ConfigError` whose message names the
 * variable to fix rather than a stack trace, so a failed start is actionable.
 */
export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
    const read = createReader(options.env ?? process.env)

    const apiKey = read(ENV_VARS.deepseekApiKey)
    if (apiKey === undefined) {
        throw new ConfigError(
            `Missing ${ENV_VARS.deepseekApiKey}. Set it in the environment, or run node with --env-file pointing at a file that defines it.`,
        )
    }

    const host = read(ENV_VARS.mcpHttpHost) ?? DEFAULT_HTTP_HOST
    const authToken = read(ENV_VARS.mcpAuthToken)
    validateAuthToken(authToken)
    validateNetworkExposure(host, authToken)
    const hostList = readHostList(read(ENV_VARS.mcpAllowedHosts))
    const allowedOrigins = readCsv(read(ENV_VARS.mcpAllowedOrigins))
    validateOrigins(allowedOrigins)

    return {
        logLevel: readLogLevel(read),
        deepseek: {
            apiKey,
            baseUrl: read(ENV_VARS.deepseekBaseUrl) ?? DEFAULT_BASE_URL,
            timeoutMs: readInteger(read, ENV_VARS.deepseekTimeoutMs, DEFAULT_TIMEOUT_MS, {
                min: MIN_TIMEOUT_MS,
                max: MAX_TIMEOUT_MS,
            }),
            maxRetries: readInteger(read, ENV_VARS.deepseekMaxRetries, DEFAULT_MAX_RETRIES, {
                min: MIN_RETRIES,
                max: MAX_RETRIES,
            }),
            search: {
                count: readInteger(read, ENV_VARS.deepseekSearchMaxResults, DEFAULT_SEARCH_COUNT, {
                    min: MIN_SEARCH_COUNT,
                    max: MAX_SEARCH_COUNT,
                }),
                contentChars: readInteger(read, ENV_VARS.deepseekSearchContentChars, DEFAULT_SEARCH_CONTENT_CHARS, {
                    min: 0,
                    max: MAX_OUTPUT_CAP,
                }),
                textChars: readInteger(read, ENV_VARS.deepseekSearchTextChars, DEFAULT_SEARCH_TEXT_CHARS, {
                    min: 0,
                    max: MAX_OUTPUT_CAP,
                }),
            },
            fetch: {
                maxChars: readInteger(read, ENV_VARS.deepseekFetchMaxChars, DEFAULT_FETCH_MAX_CHARS, {
                    min: 0,
                    max: MAX_OUTPUT_CAP,
                }),
            },
        },
        http: {
            host,
            port: readInteger(read, ENV_VARS.mcpHttpPort, DEFAULT_HTTP_PORT, { min: MIN_PORT, max: MAX_PORT }),
            path: read(ENV_VARS.mcpHttpPath) ?? DEFAULT_HTTP_PATH,
            authToken,
            allowedHosts: hostList.hosts,
            hostGuardOptOut: hostList.optedOut,
            allowedOrigins,
        },
    }
}

/** Loopback addresses are only reachable from this machine. */
export function isLoopbackHost(host: string): boolean {
    return (LOOPBACK_HOSTS as readonly string[]).includes(host)
}

type Reader = (name: string) => string | undefined

/** An unknown level is a typo, not a preference: name the accepted values. */
function readLogLevel(read: Reader): LogLevel {
    const raw = read(ENV_VARS.mcpLogLevel)
    if (raw === undefined) return DEFAULT_LOG_LEVEL

    if (!isLogLevel(raw)) {
        throw new ConfigError(`${ENV_VARS.mcpLogLevel} must be one of ${LOG_LEVELS.join(', ')}, got "${raw}".`)
    }
    return raw
}

/** A blank value means "unset", so a commented-out line in `.env` keeps the default. */
function createReader(env: NodeJS.ProcessEnv): Reader {
    return (name) => {
        const value = env[name]
        if (value === undefined) return undefined

        const trimmed = value.trim()
        return trimmed === '' ? undefined : trimmed
    }
}

function readInteger(read: Reader, name: string, fallback: number, range: { min: number; max: number }): number {
    const raw = read(name)
    if (raw === undefined) return fallback

    const value = Number(raw)
    if (!Number.isInteger(value)) {
        throw new ConfigError(`${name} must be an integer, got "${raw}".`)
    }
    if (value < range.min || value > range.max) {
        throw new ConfigError(`${name} must be between ${range.min} and ${range.max}, got ${value}.`)
    }
    return value
}

function readCsv(raw: string | undefined): string[] | undefined {
    if (raw === undefined) return undefined

    const entries = raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')

    return entries.length > 0 ? entries : undefined
}

/**
 * `MCP_ALLOWED_HOSTS=*` is an acknowledged opt-out rather than a pattern: the
 * SDK compares hostnames literally, so `*` would otherwise match nothing.
 */
function readHostList(raw: string | undefined): { hosts: string[] | undefined; optedOut: boolean } {
    const entries = readCsv(raw)
    if (entries === undefined) return { hosts: undefined, optedOut: false }
    if (entries.includes(LIST_WILDCARD)) return { hosts: undefined, optedOut: true }

    return { hosts: entries, optedOut: false }
}

/**
 * The origin guard is always installed, so an entry that can never match would
 * silently reject every browser client -- the server would start looking healthy
 * while being unusable. Reject those entries at startup instead.
 *
 * The SDK compares two things: a bare hostname, or `<scheme>://*` for a scheme
 * other than http/https. Anything else is dead weight: a full origin including
 * its scheme, a hostname with a port, the opaque `null`, or a bare `*`.
 */
function validateOrigins(origins: string[] | undefined): void {
    if (origins === undefined) return

    for (const entry of origins) {
        const reason = describeDeadOriginEntry(entry)
        if (reason === undefined) continue

        throw new ConfigError(
            `${ENV_VARS.mcpAllowedOrigins} entry "${entry}" can never match a request: ${reason}. List bare hostnames (server.example, 127.0.0.1, [::1]) or a non-http scheme wildcard such as chrome-extension://* .`,
        )
    }
}

/** Why an allowlist entry could never match, or `undefined` when it can. */
function describeDeadOriginEntry(entry: string): string | undefined {
    if (entry === LIST_WILDCARD) return 'a bare wildcard matches nothing'
    if (entry === OPAQUE_ORIGIN) return 'an opaque origin has no hostname to match'

    const schemeWildcard = SCHEME_WILDCARD.exec(entry)
    if (schemeWildcard !== null) {
        const scheme = schemeWildcard[1].toLowerCase()
        return scheme === 'http' || scheme === 'https'
            ? 'only non-http schemes are honoured, so this one matches no origin'
            : undefined
    }

    if (entry.includes('://')) {
        return `entries are hostnames, not origins; use ${bareHostname(entry)}`
    }

    if (HOST_WITH_PORT.test(entry)) return 'matching ignores the port, so a hostname entry never includes one'

    return undefined
}

/** The hostname inside an origin, for the message that corrects it. */
function bareHostname(origin: string): string {
    try {
        const hostname = new URL(origin).hostname
        return hostname === '' ? 'the hostname without scheme or port' : hostname
    } catch {
        return 'the hostname without scheme or port'
    }
}

function validateAuthToken(authToken: string | undefined): void {
    if (authToken === undefined) return
    if (authToken.length < MIN_AUTH_TOKEN_LENGTH) {
        throw new ConfigError(
            `${ENV_VARS.mcpAuthToken} must be at least ${MIN_AUTH_TOKEN_LENGTH} characters. Generate one with: openssl rand -hex 32`,
        )
    }
}

/**
 * A bind away from loopback exposes the endpoint to the network, so refuse to
 * start without the bearer token the MCP specification expects an operator to
 * supply. The `Host` allowlist is not part of that requirement: it stays
 * optional, and an unset list installs no `Host` guard.
 */
function validateNetworkExposure(host: string, authToken: string | undefined): void {
    if (isLoopbackHost(host)) return
    if (authToken !== undefined) return

    throw new ConfigError(
        `Binding to ${host} exposes this server to the network. Set ${ENV_VARS.mcpAuthToken} (generate one with: openssl rand -hex 32) before starting.`,
    )
}
