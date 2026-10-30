import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { DeepSeekSearchAndFetch } from '../deepseek/client.ts'
import { MAX_URL_CHARS } from '../deepseek/constants.ts'
import { describeDeepSeekError } from '../deepseek/errors.ts'
import { formatFetchedPage } from '../deepseek/format.ts'

export const FETCH_TOOL_NAME = 'deepseek_fetch'

export type FetchToolOptions = {
    /** Maximum characters of Markdown returned to the model. */
    maxChars: number
}

const fetchOutputSchema = z.object({
    url: z.string(),
    title: z.string(),
    content_chars: z.number().int(),
    truncated: z.boolean(),
})

const ALLOWED_PROTOCOLS = ['http:', 'https:']

export function registerFetchTool(server: McpServer, client: DeepSeekSearchAndFetch, options: FetchToolOptions): void {
    server.registerTool(
        FETCH_TOOL_NAME,
        {
            title: 'DeepSeek page fetch',
            description:
                'Fetch one web page and return its title and content as Markdown. Use it when a search summary is not enough or when the user gives you a URL.',
            inputSchema: z.object({
                url: z
                    .url()
                    .max(MAX_URL_CHARS)
                    .refine(isFetchableUrl, { message: 'Must be an http(s) URL with a host and no credentials.' })
                    .describe('Absolute HTTP or HTTPS URL to fetch.'),
            }),
            outputSchema: fetchOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async ({ url }) => {
            try {
                const page = await client.fetchPage({ url })
                const formatted = formatFetchedPage(page, url, options.maxChars)

                return {
                    content: [{ type: 'text', text: formatted.text }],
                    structuredContent: {
                        url,
                        title: page.title,
                        content_chars: page.content.length,
                        truncated: formatted.truncated,
                    },
                }
            } catch (error) {
                return { content: [{ type: 'text', text: describeDeepSeekError(error) }], isError: true }
            }
        },
    )
}

/**
 * DeepSeek rejects URLs without a host or with embedded credentials, so reject
 * them here as well: the model gets a clear message instead of a 400.
 */
function isFetchableUrl(value: string): boolean {
    if (!URL.canParse(value)) return false

    const url = new URL(value)
    if (!ALLOWED_PROTOCOLS.includes(url.protocol)) return false
    if (url.host === '') return false
    return url.username === '' && url.password === ''
}
