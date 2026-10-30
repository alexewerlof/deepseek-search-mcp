/**
 * DeepSeek Search and Fetch API constants.
 *
 * The request and response shapes are documented at
 * https://api-docs.deepseek.com/api/search and
 * https://api-docs.deepseek.com/api/fetch
 */
export const SEARCH_PATH = '/v1/tools/search'
export const FETCH_PATH = '/v1/tools/fetch'

export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_RETRIES = 2

/** API limits: `query` is 1-128 characters, `count` is 1-50. */
export const MAX_QUERY_CHARS = 128
export const MIN_SEARCH_COUNT = 1
export const MAX_SEARCH_COUNT = 50

/** `url` is at most 8192 characters and must be HTTP(S) without credentials. */
export const MAX_URL_CHARS = 8192

/**
 * Defaults chosen for local models: a handful of results with short excerpts
 * keeps the tool result inside a small context window.
 */
export const DEFAULT_SEARCH_COUNT = 5
export const DEFAULT_SEARCH_CONTENT_CHARS = 2_000
export const DEFAULT_SEARCH_TEXT_CHARS = 12_000
export const DEFAULT_FETCH_MAX_CHARS = 20_000

/** Refuse a per-call cap above this, so one call cannot blow up a context. */
export const MAX_OUTPUT_CAP = 60_000

/** DeepSeek retries advice: only 408, 429 and 5xx are worth retrying. */
export const RETRYABLE_STATUS_CODES = [408, 429] as const

export const HTTP_STATUS_UNAUTHORIZED = 401
export const HTTP_STATUS_INSUFFICIENT_BALANCE = 402
export const HTTP_STATUS_FORBIDDEN = 403
export const HTTP_STATUS_NOT_FOUND = 404
export const HTTP_STATUS_REQUEST_TIMEOUT = 408
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429
export const HTTP_STATUS_SERVER_ERROR = 500

/** HTTP status used for failures that never reached the API (DNS, TLS, abort). */
export const STATUS_TRANSPORT_FAILURE = 0

/** HTTP status used for a 2xx body this server could not parse into the schema. */
export const STATUS_INVALID_RESPONSE = -1

export const RETRY_BASE_DELAY_MS = 500
export const RETRY_JITTER_MS = 250

export const TRUNCATION_MARKER = '\n… [truncated]'

/** Marker appended to an error message so the model knows what to tell a human. */
export const SERVER_SIDE_KEY_HINT = 'The API key lives on the MCP server, in DEEPSEEK_API_KEY.'
