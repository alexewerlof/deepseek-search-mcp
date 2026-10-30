import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { McpServer } from '@modelcontextprotocol/server'
import type { DeepSeekSearchAndFetch } from '../../src/deepseek/client.ts'
import { DeepSeekApiError } from '../../src/deepseek/errors.ts'
import type { FetchRequest, SearchRequest } from '../../src/deepseek/schemas.ts'
import { createServer } from '../../src/server.ts'
import { FETCH_TOOL_NAME } from '../../src/tools/fetch.ts'
import { SEARCH_TOOL_NAME } from '../../src/tools/search.ts'

type ToolResult = {
    content: Array<{ type: string; text?: string }>
    structuredContent?: Record<string, unknown>
    isError?: boolean
}

function createStubClient(overrides: Partial<DeepSeekSearchAndFetch> = {}): DeepSeekSearchAndFetch {
    return {
        search: async () => ({ results: [] }),
        fetchPage: async () => ({ title: '', content: '' }),
        ...overrides,
    }
}

async function connect(client: DeepSeekSearchAndFetch): Promise<{ mcp: Client; server: McpServer }> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createServer({
        client,
        search: { count: 5, contentChars: 200, textChars: 2_000 },
        fetch: { maxChars: 200 },
    })
    await server.connect(serverTransport)

    const mcp = new Client({ name: 'test-harness', version: '0.0.0' })
    await mcp.connect(clientTransport)

    return { mcp, server }
}

function textOf(result: ToolResult): string {
    const block = result.content[0]
    assert.ok(block !== undefined, 'the tool returned no content')
    assert.equal(block.type, 'text')
    assert.equal(typeof block.text, 'string')
    return block.text as string
}

describe('deepseek_search tool', () => {
    it('is registered with the expected name', async (t) => {
        const { mcp, server } = await connect(createStubClient())
        t.after(async () => {
            await mcp.close()
            await server.close()
        })

        const tools = await mcp.listTools()
        assert.ok(tools.tools.some((tool) => tool.name === SEARCH_TOOL_NAME))
    })

    it('passes arguments through and returns text plus compact metadata', async (t) => {
        const requests: SearchRequest[] = []
        const { mcp, server } = await connect(
            createStubClient({
                search: async (request) => {
                    requests.push(request)
                    return {
                        results: [
                            {
                                rerank_score: 2.4,
                                title: 'Result title',
                                url: 'https://example.com/a',
                                snippet: 'snippet',
                                summary: 'summary text',
                                content: '',
                                site_name: 'Example',
                                site_icon: null,
                                date: null,
                                authority: 3,
                            },
                        ],
                    }
                },
            }),
        )
        t.after(async () => {
            await mcp.close()
            await server.close()
        })

        const result = (await mcp.callTool({
            name: SEARCH_TOOL_NAME,
            arguments: { query: 'deepseek', count: 2, need_content: true },
        })) as ToolResult

        assert.equal(requests[0]?.query, 'deepseek')
        assert.equal(requests[0]?.count, 2)
        assert.equal(requests[0]?.needContent, true)
        assert.equal(result.isError, undefined)
        assert.match(textOf(result), /Result title/)
        assert.equal(result.structuredContent?.returned, 1)
    })

    it('applies the configured default count', async (t) => {
        const requests: SearchRequest[] = []
        const { mcp, server } = await connect(
            createStubClient({
                search: async (request) => {
                    requests.push(request)
                    return { results: [] }
                },
            }),
        )
        t.after(async () => {
            await mcp.close()
            await server.close()
        })

        await mcp.callTool({ name: SEARCH_TOOL_NAME, arguments: { query: 'x' } })

        assert.equal(requests[0]?.count, 5)
        assert.equal(requests[0]?.needContent, false)
    })

    it('rejects an empty query before calling DeepSeek', async (t) => {
        let called = false
        const { mcp, server } = await connect(
            createStubClient({
                search: async () => {
                    called = true
                    return { results: [] }
                },
            }),
        )
        t.after(async () => {
            await mcp.close()
            await server.close()
        })

        const result = (await mcp.callTool({ name: SEARCH_TOOL_NAME, arguments: { query: '' } })) as ToolResult

        assert.equal(result.isError, true)
        assert.equal(called, false)
    })

    it('turns an API failure into an actionable isError result', async (t) => {
        const { mcp, server } = await connect(
            createStubClient({
                search: async () => {
                    throw new DeepSeekApiError('insufficient balance', {
                        status: 402,
                        code: 'http_402',
                        retryable: false,
                    })
                },
            }),
        )
        t.after(async () => {
            await mcp.close()
            await server.close()
        })

        const result = (await mcp.callTool({ name: SEARCH_TOOL_NAME, arguments: { query: 'x' } })) as ToolResult

        assert.equal(result.isError, true)
        assert.match(textOf(result), /insufficient balance/)
        assert.match(textOf(result), /Top up/)
    })
})

describe('deepseek_fetch tool', () => {
    it('returns the page and its metadata', async (t) => {
        const requests: FetchRequest[] = []
        const { mcp, server } = await connect(
            createStubClient({
                fetchPage: async (request) => {
                    requests.push(request)
                    return { title: 'Example Domain', content: '# Example Domain' }
                },
            }),
        )
        t.after(async () => {
            await mcp.close()
            await server.close()
        })

        const result = (await mcp.callTool({
            name: FETCH_TOOL_NAME,
            arguments: { url: 'https://example.com' },
        })) as ToolResult

        assert.equal(requests[0]?.url, 'https://example.com')
        assert.match(textOf(result), /Example Domain/)
        assert.equal(result.structuredContent?.content_chars, '# Example Domain'.length)
        assert.equal(result.structuredContent?.truncated, false)
    })

    it('rejects a non-HTTP url before calling DeepSeek', async (t) => {
        let called = false
        const { mcp, server } = await connect(
            createStubClient({
                fetchPage: async () => {
                    called = true
                    return { title: '', content: '' }
                },
            }),
        )
        t.after(async () => {
            await mcp.close()
            await server.close()
        })

        const result = (await mcp.callTool({
            name: FETCH_TOOL_NAME,
            arguments: { url: 'file:///etc/passwd' },
        })) as ToolResult

        assert.equal(result.isError, true)
        assert.equal(called, false)
    })

    it('reports truncation in the structured result', async (t) => {
        const { mcp, server } = await connect(
            createStubClient({ fetchPage: async () => ({ title: 'T', content: 'z'.repeat(500) }) }),
        )
        t.after(async () => {
            await mcp.close()
            await server.close()
        })

        const result = (await mcp.callTool({
            name: FETCH_TOOL_NAME,
            arguments: { url: 'https://example.com' },
        })) as ToolResult

        assert.equal(result.structuredContent?.truncated, true)
        assert.equal(result.structuredContent?.content_chars, 500)
    })
})
