import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatFetchedPage, formatSearchResults, truncateText } from '../../src/deepseek/format.ts'
import type { SearchResult } from '../../src/deepseek/schemas.ts'

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
    return {
        rerank_score: 2.4,
        title: 'DeepSeek V4 released',
        url: 'https://example.com/deepseek-v4',
        snippet: 'Short snippet.',
        summary: 'A longer summary written for a model to read.',
        content: '',
        site_name: 'Example News',
        site_icon: null,
        date: '2026-06-01T00:00:00+00:00',
        authority: 3,
        ...overrides,
    }
}

describe('truncateText', () => {
    it('leaves short text untouched', () => {
        assert.deepEqual(truncateText('hello', 10), { text: 'hello', truncated: false })
    })

    it('marks text that was cut', () => {
        const result = truncateText('hello world', 5)
        assert.equal(result.truncated, true)
        assert.ok(result.text.startsWith('hello'))
        assert.ok(result.text.includes('[truncated]'))
    })

    it('handles a zero budget', () => {
        assert.deepEqual(truncateText('hello', 0), { text: '\n… [truncated]', truncated: true })
    })

    it('does not split a surrogate pair', () => {
        const result = truncateText(`a\u{1F600}b`, 2)
        assert.equal(result.text.startsWith('a'), true)
        assert.equal(/[\uD800-\uDBFF]/.test(result.text), false)
    })
})

describe('formatSearchResults', () => {
    it('reports an empty result set without pretending it is an error', () => {
        const formatted = formatSearchResults({ results: [] }, 'nothing here', { contentChars: 100, textChars: 1_000 })
        assert.equal(formatted.truncated, false)
        assert.match(formatted.text, /No results for "nothing here"/)
    })

    it('renders url, metadata, and the summary once', () => {
        const formatted = formatSearchResults({ results: [makeResult()] }, 'deepseek v4', {
            contentChars: 100,
            textChars: 1_000,
        })

        assert.match(formatted.text, /1\. DeepSeek V4 released/)
        assert.match(formatted.text, /URL: https:\/\/example\.com\/deepseek-v4/)
        assert.match(formatted.text, /site: Example News/)
        assert.match(formatted.text, /relevance: 2\.40/)
        assert.match(formatted.text, /A longer summary written for a model/)
        assert.ok(!formatted.text.includes('Short snippet.'), 'the snippet should not duplicate the summary')
    })

    it('falls back to the snippet when the summary is empty', () => {
        const formatted = formatSearchResults({ results: [makeResult({ summary: '' })] }, 'q', {
            contentChars: 100,
            textChars: 1_000,
        })
        assert.match(formatted.text, /Short snippet\./)
    })

    it('caps page content and flags it', () => {
        const formatted = formatSearchResults({ results: [makeResult({ content: 'x'.repeat(50) })] }, 'q', {
            contentChars: 10,
            textChars: 10_000,
        })
        assert.equal(formatted.truncated, true)
        assert.match(formatted.text, /Content: x{10}/)
    })

    it('caps the whole block and flags it', () => {
        const formatted = formatSearchResults(
            { results: [makeResult(), makeResult({ title: 'Second result' })] },
            'q',
            { contentChars: 100, textChars: 40 },
        )
        assert.equal(formatted.truncated, true)
        assert.ok(formatted.text.length <= 40 + '\n… [truncated]'.length)
    })
})

describe('formatFetchedPage', () => {
    it('includes the url, title, and content', () => {
        const formatted = formatFetchedPage({ title: 'Example', content: '# Hello' }, 'https://example.com', 1_000)
        assert.match(formatted.text, /URL: https:\/\/example\.com/)
        assert.match(formatted.text, /Title: Example/)
        assert.match(formatted.text, /# Hello/)
        assert.equal(formatted.truncated, false)
    })

    it('labels a page without a title', () => {
        const formatted = formatFetchedPage({ title: '   ', content: 'body' }, 'https://example.com', 1_000)
        assert.match(formatted.text, /Title: \(untitled\)/)
    })

    it('caps long content', () => {
        const formatted = formatFetchedPage({ title: 'T', content: 'y'.repeat(100) }, 'https://example.com', 10)
        assert.equal(formatted.truncated, true)
        assert.ok(formatted.text.includes('[truncated]'))
    })
})
