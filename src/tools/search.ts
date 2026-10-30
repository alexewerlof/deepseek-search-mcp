import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { DeepSeekSearchAndFetch } from '../deepseek/client.ts'
import { MAX_QUERY_CHARS, MAX_SEARCH_COUNT, MIN_SEARCH_COUNT } from '../deepseek/constants.ts'
import { describeDeepSeekError } from '../deepseek/errors.ts'
import { formatSearchResults } from '../deepseek/format.ts'
import type { SearchResult } from '../deepseek/schemas.ts'

export const SEARCH_TOOL_NAME = 'deepseek_search'

export type SearchToolOptions = {
    /** Result count used when the model does not pass `count`. */
    count: number
    contentChars: number
    textChars: number
}

const resultMetadataSchema = z.object({
    title: z.string(),
    url: z.string(),
    site_name: z.string().nullable(),
    date: z.string().nullable(),
    rerank_score: z.number(),
    authority: z.number().int(),
})

const searchOutputSchema = z.object({
    query: z.string(),
    returned: z.number().int(),
    truncated: z.boolean(),
    results: z.array(resultMetadataSchema),
})

const DEFAULT_NEED_CONTENT = false

export function registerSearchTool(
    server: McpServer,
    client: DeepSeekSearchAndFetch,
    options: SearchToolOptions,
): void {
    server.registerTool(
        SEARCH_TOOL_NAME,
        {
            title: 'DeepSeek web search',
            description:
                'Search the web for current information. Returns ranked results with title, URL, publication date, and a summary. Set need_content to also return page text. Supports the operators site:, -site:, "exact phrase", lang:, after:, and before:.',
            inputSchema: z.object({
                query: z
                    .string()
                    .min(1)
                    .max(MAX_QUERY_CHARS)
                    .describe('Search query, 1-128 characters. Operators such as site:github.com are allowed.'),
                count: z
                    .number()
                    .int()
                    .min(MIN_SEARCH_COUNT)
                    .max(MAX_SEARCH_COUNT)
                    .default(options.count)
                    .describe(`Number of results to return, ${MIN_SEARCH_COUNT}-${MAX_SEARCH_COUNT}.`),
                need_content: z
                    .boolean()
                    .default(DEFAULT_NEED_CONTENT)
                    .describe('Return the page text for each result. Costs more context, so use it only when needed.'),
                ori_question: z
                    .string()
                    .min(1)
                    .max(MAX_QUERY_CHARS)
                    .optional()
                    .describe('The user’s original question, when the query alone is ambiguous. Improves ranking.'),
            }),
            outputSchema: searchOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async ({ query, count, need_content, ori_question }) => {
            try {
                const response = await client.search({
                    query,
                    count,
                    needContent: need_content,
                    oriQuestion: ori_question,
                })
                const formatted = formatSearchResults(response, query, {
                    contentChars: options.contentChars,
                    textChars: options.textChars,
                })

                return {
                    content: [{ type: 'text', text: formatted.text }],
                    structuredContent: {
                        query,
                        returned: response.results.length,
                        truncated: formatted.truncated,
                        results: response.results.map(toResultMetadata),
                    },
                }
            } catch (error) {
                return { content: [{ type: 'text', text: describeDeepSeekError(error) }], isError: true }
            }
        },
    )
}

/** Compact metadata only: the long prose is already in the text block. */
function toResultMetadata(result: SearchResult): z.infer<typeof resultMetadataSchema> {
    return {
        title: result.title,
        url: result.url,
        site_name: result.site_name,
        date: result.date,
        rerank_score: result.rerank_score,
        authority: result.authority,
    }
}
