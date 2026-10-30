import type * as z from 'zod/v4'
import { FETCH_PATH, RETRY_BASE_DELAY_MS, RETRY_JITTER_MS, SEARCH_PATH } from './constants.ts'
import { createHttpError, createInvalidResponseError, createTransportError, DeepSeekApiError } from './errors.ts'
import {
    fetchResponseSchema,
    searchResponseSchema,
    type FetchRequest,
    type FetchResponse,
    type SearchRequest,
    type SearchResponse,
} from './schemas.ts'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type SleepLike = (milliseconds: number) => Promise<void>

/**
 * The slice of the DeepSeek client the tools depend on. Tools accept this
 * interface, so tests can supply a plain object instead of a live client.
 */
export interface DeepSeekSearchAndFetch {
    search(request: SearchRequest): Promise<SearchResponse>
    fetchPage(request: FetchRequest): Promise<FetchResponse>
}

export type DeepSeekClientOptions = {
    apiKey: string
    baseUrl: string
    timeoutMs: number
    maxRetries: number
    /** Injected in tests; defaults to the global `fetch`. */
    fetch?: FetchLike
    /** Injected in tests so retry delays do not actually wait. */
    sleep?: SleepLike
    /** Injected in tests to make jitter deterministic. */
    random?: () => number
}

const TIMEOUT_ERROR_NAME = 'TimeoutError'
const TRAILING_SLASHES = /\/+$/
const REQUEST_FAILED_MESSAGE = 'DeepSeek request failed'

export class DeepSeekClient implements DeepSeekSearchAndFetch {
    private readonly apiKey: string
    private readonly baseUrl: string
    private readonly timeoutMs: number
    private readonly maxRetries: number
    private readonly fetchImpl: FetchLike
    private readonly sleep: SleepLike
    private readonly random: () => number

    constructor(options: DeepSeekClientOptions) {
        this.apiKey = options.apiKey
        this.baseUrl = options.baseUrl.replace(TRAILING_SLASHES, '')
        this.timeoutMs = options.timeoutMs
        this.maxRetries = options.maxRetries
        this.fetchImpl = options.fetch ?? defaultFetch
        this.sleep = options.sleep ?? defaultSleep
        this.random = options.random ?? Math.random
    }

    search(request: SearchRequest): Promise<SearchResponse> {
        return this.postJson(SEARCH_PATH, toSearchBody(request), searchResponseSchema)
    }

    fetchPage(request: FetchRequest): Promise<FetchResponse> {
        return this.postJson(FETCH_PATH, { url: request.url }, fetchResponseSchema)
    }

    /**
     * Retries only what DeepSeek says is worth retrying: 408, 429 and 5xx, plus
     * transport failures. Every other 4xx is a request problem, so retrying it
     * would just burn another billable attempt.
     */
    private async postJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
        let attempt = 0

        for (;;) {
            try {
                return await this.send(path, body, schema)
            } catch (error) {
                const canRetry = error instanceof DeepSeekApiError && error.retryable
                if (!canRetry || attempt >= this.maxRetries) throw error

                attempt += 1
                await this.sleep(this.backoffDelay(attempt))
            }
        }
    }

    private async send<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
        const response = await this.request(path, body)
        const text = await readBodyText(response)

        if (!response.ok) throw createHttpError(response.status, text)

        const parsed = parseJson(text)
        if (parsed === undefined) throw createInvalidResponseError('the body was not valid JSON')

        const result = schema.safeParse(parsed)
        if (!result.success) throw createInvalidResponseError(summarizeIssues(result.error))

        return result.data
    }

    private async request(path: string, body: unknown): Promise<Response> {
        try {
            return await this.fetchImpl(`${this.baseUrl}${path}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs),
            })
        } catch (error) {
            throw createTransportError(describeRequestFailure(error, this.timeoutMs))
        }
    }

    private backoffDelay(attempt: number): number {
        const exponential = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
        const jitter = Math.floor(this.random() * RETRY_JITTER_MS)
        return exponential + jitter
    }
}

function toSearchBody(request: SearchRequest): Record<string, unknown> {
    const body: Record<string, unknown> = { query: request.query }
    if (request.count !== undefined) body.count = request.count
    if (request.oriQuestion !== undefined) body.ori_question = request.oriQuestion
    if (request.needContent !== undefined) body.need_content = request.needContent
    return body
}

function defaultFetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init)
}

function defaultSleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function readBodyText(response: Response): Promise<string> {
    try {
        return await response.text()
    } catch (error) {
        throw createTransportError(describeRequestFailure(error, undefined))
    }
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

function summarizeIssues(error: z.ZodError): string {
    const issues = error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
        return `${path}: ${issue.message}`
    })
    return issues.length > 0 ? issues.join('; ') : 'the body did not match the expected shape'
}

function describeRequestFailure(error: unknown, timeoutMs: number | undefined): string {
    if (isTimeout(error)) {
        return timeoutMs === undefined ? 'the request timed out' : `the request timed out after ${timeoutMs} ms`
    }
    if (error instanceof Error) return error.message
    return REQUEST_FAILED_MESSAGE
}

function isTimeout(error: unknown): boolean {
    return error instanceof Error && error.name === TIMEOUT_ERROR_NAME
}
