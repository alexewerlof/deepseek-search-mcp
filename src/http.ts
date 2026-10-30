import { once } from 'node:events'
import type { Server as NodeHttpServer } from 'node:http'
import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server'
import type { Express, RequestHandler } from 'express'
import { createStaticTokenVerifier } from './auth.ts'
import type { ServerConfig } from './config.ts'
import { SERVER_NAME } from './constants.ts'
import { createServer, type CreateServerOptions } from './server.ts'

export type RunningHttpServer = {
    /** URL clients can use, with the real port when the config asked for 0. */
    url: string
    close: () => Promise<void>
}

/**
 * Starts the Streamable HTTP endpoint.
 *
 * The SDK handler serves 2025-era clients (what LM Studio speaks) and the
 * 2026-07-28 revision from the same factory, so no era flag is needed here.
 * Response shaping stays on the default: a single JSON body unless a tool emits
 * a mid-call notification, which these tools never do.
 */
export async function startHttpServer(
    config: ServerConfig,
    serverOptions: CreateServerOptions,
): Promise<RunningHttpServer> {
    const handler = createMcpHandler(() => createServer(serverOptions), {
        onerror: (error) => console.error(`[${SERVER_NAME}] request failed: ${error.message}`),
    })
    const app = buildApp(config, handler)

    const nodeServer = app.listen(config.http.port, config.http.host)
    await once(nodeServer, 'listening')

    return {
        url: buildUrl(config, nodeServer),
        close: async () => {
            await closeNodeServer(nodeServer)
            await handler.close()
        },
    }
}

function buildApp(config: ServerConfig, handler: McpHttpHandler): Express {
    const app = createMcpExpressApp({
        host: config.http.host,
        allowedHosts: config.http.allowedHosts,
        allowedOrigins: config.http.allowedOrigins,
    })
    const nodeHandler = toNodeHandler(handler)
    // `express.json()` has already consumed the stream, so hand the parsed body
    // over instead of letting the adapter try to read it again.
    const respond: RequestHandler = (req, res) => {
        void nodeHandler(req, res, req.body)
    }

    // Loopback-only deployments may run without a token; `loadConfig` refuses a
    // non-loopback bind unless a token is present, so this branch cannot expose
    // an unprotected public endpoint.
    if (config.http.authToken === undefined) {
        app.all(config.http.path, respond)
        return app
    }

    const auth = requireBearerAuth({ verifier: createStaticTokenVerifier(config.http.authToken) })
    app.all(config.http.path, auth, respond)
    return app
}

function buildUrl(config: ServerConfig, server: NodeHttpServer): string {
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : config.http.port
    const host = config.http.host.includes(':') ? `[${config.http.host}]` : config.http.host
    return `http://${host}:${port}${config.http.path}`
}

function closeNodeServer(server: NodeHttpServer): Promise<void> {
    if (!server.listening) return Promise.resolve()

    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) resolve()
            else reject(error)
        })
    })
}
