import { TRUNCATION_MARKER } from './constants.ts'
import type { FetchResponse, SearchResponse, SearchResult } from './schemas.ts'

export type FormattedText = {
    text: string
    truncated: boolean
}

/** A high surrogate left behind when a slice splits an astral character. */
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF]$/

export type SearchFormatOptions = {
    /** Upper bound for a single result's `content` field. */
    contentChars: number
    /** Upper bound for the whole text block. */
    textChars: number
}

/**
 * Cuts text to a budget, appending a marker so the model can tell the
 * difference between "this is everything" and "this was clipped".
 *
 * A budget is counted in UTF-16 code units, so a cut can land between the two
 * halves of a surrogate pair. The dangling high surrogate is removed: a lone
 * half renders as a replacement character and corrupts the text.
 */
export function truncateText(value: string, maxChars: number): FormattedText {
    if (value.length <= maxChars) return { text: value, truncated: false }

    const clipped = value.slice(0, maxChars).replace(LONE_HIGH_SURROGATE, '')
    return { text: `${clipped}${TRUNCATION_MARKER}`, truncated: true }
}

/**
 * Renders search results for a model to read.
 *
 * `summary` and `snippet` describe the same page at different lengths, so only
 * the longer one is shown: repeating both would waste context for no new
 * information.
 */
export function formatSearchResults(
    response: SearchResponse,
    query: string,
    options: SearchFormatOptions,
): FormattedText {
    if (response.results.length === 0) {
        return { text: `No results for "${query}".`, truncated: false }
    }

    const blocks = response.results.map((result, index) => formatResult(result, index + 1, options.contentChars))
    const header = `Query: ${query}\nResults: ${response.results.length}`
    const combined = [header, ...blocks.map((block) => block.text)].join('\n\n')
    const clipped = truncateText(combined, options.textChars)

    return {
        text: clipped.text,
        truncated: clipped.truncated || blocks.some((block) => block.truncated),
    }
}

export function formatFetchedPage(page: FetchResponse, url: string, maxChars: number): FormattedText {
    const title = page.title.trim() === '' ? '(untitled)' : page.title.trim()
    const content = truncateText(page.content, maxChars)
    const header = `URL: ${url}\nTitle: ${title}\nContent length: ${page.content.length} characters`

    return { text: `${header}\n\n${content.text}`, truncated: content.truncated }
}

function formatResult(result: SearchResult, position: number, contentChars: number): FormattedText {
    const lines = [`${position}. ${result.title}`, `   URL: ${result.url}`, `   ${formatMetadata(result)}`]

    const body = result.summary.trim() !== '' ? result.summary : result.snippet
    if (body.trim() !== '') lines.push(`   ${body.trim()}`)

    if (result.content.trim() === '') {
        return { text: lines.join('\n'), truncated: false }
    }

    const content = truncateText(result.content.trim(), contentChars)
    lines.push(`   Content: ${content.text}`)
    return { text: lines.join('\n'), truncated: content.truncated }
}

function formatMetadata(result: SearchResult): string {
    const parts: string[] = []
    if (result.site_name !== null) parts.push(`site: ${result.site_name}`)
    if (result.date !== null) parts.push(`published: ${result.date}`)
    parts.push(`authority: ${result.authority}`, `relevance: ${result.rerank_score.toFixed(2)}`)
    return parts.join(' | ')
}
