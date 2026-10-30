import { McpServer } from '@modelcontextprotocol/server'
import { SERVER_NAME, SERVER_VERSION } from './constants.ts'
import type { DeepSeekSearchAndFetch } from './deepseek/client.ts'
import { registerFetchTool, type FetchToolOptions } from './tools/fetch.ts'
import { registerSearchTool, type SearchToolOptions } from './tools/search.ts'

export type CreateServerOptions = {
    client: DeepSeekSearchAndFetch
    search: SearchToolOptions
    fetch: FetchToolOptions
}

/**
 * Builds one `McpServer` with both tools registered.
 *
 * Called once per request by the HTTP handler, so it must stay free of I/O:
 * connection state and configuration belong to the caller, not to this factory.
 */
export function createServer(options: CreateServerOptions): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

    registerSearchTool(server, options.client, options.search)
    registerFetchTool(server, options.client, options.fetch)

    return server
}
