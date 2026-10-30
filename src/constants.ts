/**
 * Values that identify this server and its on-disk configuration.
 *
 * Everything here is a single source of truth: if you need one of these
 * strings somewhere else, import it instead of repeating the literal.
 */
export const SERVER_NAME = 'deepseek-search-mcp'
export const SERVER_VERSION = '0.1.0'

export const ENV_VARS = {
    deepseekApiKey: 'DEEPSEEK_API_KEY',
    deepseekBaseUrl: 'DEEPSEEK_BASE_URL',
    deepseekTimeoutMs: 'DEEPSEEK_TIMEOUT_MS',
    deepseekMaxRetries: 'DEEPSEEK_MAX_RETRIES',
    deepseekSearchMaxResults: 'DEEPSEEK_SEARCH_MAX_RESULTS',
    deepseekSearchContentChars: 'DEEPSEEK_SEARCH_CONTENT_CHARS',
    deepseekSearchTextChars: 'DEEPSEEK_SEARCH_TEXT_CHARS',
    deepseekFetchMaxChars: 'DEEPSEEK_FETCH_MAX_CHARS',
    mcpHttpHost: 'MCP_HTTP_HOST',
    mcpHttpPort: 'MCP_HTTP_PORT',
    mcpHttpPath: 'MCP_HTTP_PATH',
    mcpAuthToken: 'MCP_AUTH_TOKEN',
    mcpAllowedHosts: 'MCP_ALLOWED_HOSTS',
    mcpAllowedOrigins: 'MCP_ALLOWED_ORIGINS',
} as const

export const DEFAULT_HTTP_HOST = '127.0.0.1'
export const DEFAULT_HTTP_PORT = 8765
export const DEFAULT_HTTP_PATH = '/mcp'

/** Addresses that are only reachable from the server machine itself. */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const

/**
 * The MCP authorization model requires a bearer token whenever the endpoint is
 * reachable from another machine. A short token is guessable, so refuse one.
 */
export const MIN_AUTH_TOKEN_LENGTH = 32

/** Reported to tool handlers as the authenticated caller. */
export const AUTH_CLIENT_ID = 'lm-studio'

/**
 * The verifier is static, so it mints an expiry far in the future. The SDK
 * rejects tokens whose `expiresAt` is unset, so a value is required even here.
 */
export const AUTH_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60
