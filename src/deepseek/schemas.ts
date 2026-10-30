import * as z from 'zod/v4'

/**
 * Wire shapes for the DeepSeek Search and Fetch APIs.
 *
 * Validation happens on every response: a 200 with an unexpected body is a
 * failure, not something to pass to the model as if it were content.
 */
export const searchResultSchema = z.object({
    rerank_score: z.number(),
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
    summary: z.string(),
    content: z.string(),
    site_name: z.string().nullable(),
    site_icon: z.string().nullable(),
    date: z.string().nullable(),
    authority: z.number().int(),
})

export const searchResponseSchema = z.object({
    results: z.array(searchResultSchema),
})

export const fetchResponseSchema = z.object({
    title: z.string(),
    content: z.string(),
})

export type SearchResult = z.infer<typeof searchResultSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>
export type FetchResponse = z.infer<typeof fetchResponseSchema>

/** Tool-facing request types; the client maps them onto the wire field names. */
export type SearchRequest = {
    query: string
    count?: number
    oriQuestion?: string
    needContent?: boolean
}

export type FetchRequest = {
    url: string
}
