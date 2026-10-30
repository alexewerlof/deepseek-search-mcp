import {
    HTTP_STATUS_FORBIDDEN,
    HTTP_STATUS_INSUFFICIENT_BALANCE,
    HTTP_STATUS_NOT_FOUND,
    HTTP_STATUS_REQUEST_TIMEOUT,
    HTTP_STATUS_SERVER_ERROR,
    HTTP_STATUS_TOO_MANY_REQUESTS,
    HTTP_STATUS_UNAUTHORIZED,
    RETRYABLE_STATUS_CODES,
    SERVER_SIDE_KEY_HINT,
    STATUS_INVALID_RESPONSE,
    STATUS_TRANSPORT_FAILURE,
} from './constants.ts'

export type DeepSeekApiErrorOptions = {
    status: number
    code: string
    retryable: boolean
}

/**
 * A failure from the DeepSeek API or from reaching it. Carries enough detail to
 * decide on a retry and enough wording to tell the model what a human should
 * do about it.
 */
export class DeepSeekApiError extends Error {
    readonly status: number
    readonly code: string
    readonly retryable: boolean

    constructor(message: string, options: DeepSeekApiErrorOptions) {
        super(message)
        this.name = 'DeepSeekApiError'
        this.status = options.status
        this.code = options.code
        this.retryable = options.retryable
    }
}

/** DeepSeek's error bodies follow the OpenAI shape: `{ error: { message, code } }`. */
type ParsedErrorBody = {
    message: string | undefined
    code: string | undefined
}

export function isRetryableStatus(status: number): boolean {
    if ((RETRYABLE_STATUS_CODES as readonly number[]).includes(status)) return true
    return status >= HTTP_STATUS_SERVER_ERROR
}

export function createHttpError(status: number, bodyText: string): DeepSeekApiError {
    const parsed = parseErrorBody(bodyText)
    const message = parsed.message ?? `DeepSeek responded with HTTP ${status}.`

    return new DeepSeekApiError(message, {
        status,
        code: parsed.code ?? `http_${status}`,
        retryable: isRetryableStatus(status),
    })
}

export function createInvalidResponseError(detail: string): DeepSeekApiError {
    return new DeepSeekApiError(`DeepSeek returned an unexpected response: ${detail}`, {
        status: STATUS_INVALID_RESPONSE,
        code: 'invalid_response',
        retryable: false,
    })
}

export function createTransportError(detail: string): DeepSeekApiError {
    return new DeepSeekApiError(detail, {
        status: STATUS_TRANSPORT_FAILURE,
        code: 'transport_error',
        retryable: true,
    })
}

/**
 * Turns any thrown value into a sentence a model can act on. Tool results are
 * read by an LLM, so "HTTP 402" alone is not useful — say what to do next.
 */
export function describeDeepSeekError(error: unknown): string {
    if (error instanceof DeepSeekApiError) return describeApiError(error)
    if (error instanceof Error) return `${error.name}: ${error.message}`
    return String(error)
}

function describeApiError(error: DeepSeekApiError): string {
    switch (error.status) {
        case HTTP_STATUS_UNAUTHORIZED:
            return `DeepSeek rejected the configured API key (HTTP 401). ${SERVER_SIDE_KEY_HINT}`
        case HTTP_STATUS_INSUFFICIENT_BALANCE:
            return 'The DeepSeek account has insufficient balance (HTTP 402). Top up the account before retrying.'
        case HTTP_STATUS_FORBIDDEN:
            return 'DeepSeek rejected this request under its security policy (HTTP 403). Try a different URL.'
        case HTTP_STATUS_NOT_FOUND:
            return 'DeepSeek could not retrieve usable page content for that URL (HTTP 404). The page may be unavailable, blocked, or not HTML.'
        case HTTP_STATUS_REQUEST_TIMEOUT:
            return `DeepSeek timed out reading the request (HTTP 408). Retrying later may succeed. ${error.message}`
        case HTTP_STATUS_TOO_MANY_REQUESTS:
            return `DeepSeek rate limit exceeded (HTTP 429). Wait a few seconds before calling again. ${error.message}`
        case STATUS_TRANSPORT_FAILURE:
            return `Could not reach the DeepSeek API: ${error.message}`
        case STATUS_INVALID_RESPONSE:
            return 'DeepSeek returned a response this server could not understand. The API may have changed.'
        default:
            if (error.status >= HTTP_STATUS_SERVER_ERROR) {
                return `DeepSeek failed temporarily (HTTP ${error.status}). Retrying later may succeed. ${error.message}`
            }
            return `DeepSeek rejected the request (HTTP ${error.status}, code ${error.code}): ${error.message}`
    }
}

function parseErrorBody(bodyText: string): ParsedErrorBody {
    const parsed = parseJson(bodyText)
    if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
        return { message: undefined, code: undefined }
    }

    if (!('error' in parsed)) return { message: undefined, code: undefined }
    const error = parsed.error
    if (typeof error !== 'object' || error === null) return { message: undefined, code: undefined }

    return {
        message: readString(error, 'message'),
        code: readString(error, 'code'),
    }
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

function readString(value: object, key: string): string | undefined {
    if (!(key in value)) return undefined
    const candidate = (value as Record<string, unknown>)[key]
    return typeof candidate === 'string' ? candidate : undefined
}
