import {
    DEFAULT_HTTP_HOST,
    DEFAULT_HTTP_PORT,
    DEFAULT_HTTP_PATH,
    ENV_VARS,
    LOOPBACK_HOSTS,
    MIN_AUTH_TOKEN_LENGTH,
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
    allowedOrigins: string[] | undefined
}

export type ServerConfig = {
    deepseek: DeepSeekConfig
    http: HttpConfig
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
    const allowedHosts = readCsv(read(ENV_VARS.mcpAllowedHosts))
    validateNetworkExposure(host, authToken, allowedHosts)

    return {
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
            allowedHosts,
            allowedOrigins: readCsv(read(ENV_VARS.mcpAllowedOrigins)),
        },
    }
}

/** Loopback addresses are only reachable from this machine. */
export function isLoopbackHost(host: string): boolean {
    return (LOOPBACK_HOSTS as readonly string[]).includes(host)
}

type Reader = (name: string) => string | undefined

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

function validateAuthToken(authToken: string | undefined): void {
    if (authToken === undefined) return
    if (authToken.length < MIN_AUTH_TOKEN_LENGTH) {
        throw new ConfigError(
            `${ENV_VARS.mcpAuthToken} must be at least ${MIN_AUTH_TOKEN_LENGTH} characters. Generate one with: openssl rand -hex 32`,
        )
    }
}

/**
 * A non-loopback bind exposes the endpoint to the network. Refuse to start
 * without the two protections the SDK expects the operator to supply: a bearer
 * token, and an explicit list of hostnames (binding away from loopback turns
 * off the adapter's built-in DNS rebinding defaults).
 */
function validateNetworkExposure(
    host: string,
    authToken: string | undefined,
    allowedHosts: string[] | undefined,
): void {
    if (isLoopbackHost(host)) return

    const problems: string[] = []
    if (authToken === undefined) {
        problems.push(`${ENV_VARS.mcpAuthToken} (generate one with: openssl rand -hex 32)`)
    }
    if (allowedHosts === undefined) {
        problems.push(`${ENV_VARS.mcpAllowedHosts} (the hostnames clients use, for example 198.51.100.10)`)
    }
    if (problems.length === 0) return

    throw new ConfigError(
        `Binding to ${host} exposes this server to the network. Set ${problems.join(' and ')} before starting.`,
    )
}
