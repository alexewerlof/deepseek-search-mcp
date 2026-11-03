import { once } from 'node:events'
import type { Server as NodeHttpServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import {
    createMcpHandler,
    localhostAllowedHostnames,
    localhostAllowedOrigins,
    type McpHttpHandler,
} from '@modelcontextprotocol/server'
import express, { type Express, type Request, type RequestHandler } from 'express'
import { createStaticTokenVerifier } from './auth.ts'
import { isLoopbackHost, type HttpConfig, type ServerConfig } from './config.ts'
import { createLogger, describeBlock, diagnoseRequest, type GuardLimits, type Logger } from './logging.ts'
import { createServer, type CreateServerOptions } from './server.ts'

export type HttpServerOptions = CreateServerOptions & {
    /** Replaces the stderr logger built from `config.logLevel`; tests capture lines. */
    logger?: Logger
}

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
export async function startHttpServer(config: ServerConfig, options: HttpServerOptions): Promise<RunningHttpServer> {
    const { logger: injectedLogger, ...serverOptions } = options
    const logger = injectedLogger ?? createLogger(config.logLevel)
    const limits = resolveGuardLimits(config.http)

    const handler = createMcpHandler(() => createServer(serverOptions), {
        onerror: (error) => logger.error(`request failed: ${error.message}`),
    })
    const app = buildApp(config, handler, limits, logger)

    const nodeServer = app.listen(config.http.port, config.http.host)
    await once(nodeServer, 'listening')

    logger.info(describeGuards(config, limits))

    return {
        url: buildUrl(config, nodeServer),
        close: async () => {
            await closeNodeServer(nodeServer)
            await handler.close()
        },
    }
}

function buildApp(config: ServerConfig, handler: McpHttpHandler, limits: GuardLimits, logger: Logger): Express {
    // The SDK app owns JSON parsing plus the `Host`/`Origin` guards. It is mounted
    // inside our app so a request a guard rejects is still logged.
    const guarded = createMcpExpressApp({
        host: config.http.host,
        allowedHosts: limits.host,
        allowedOrigins: limits.origin,
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
        guarded.all(config.http.path, respond)
    } else {
        const auth = requireBearerAuth({ verifier: createStaticTokenVerifier(config.http.authToken) })
        guarded.all(config.http.path, auth, respond)
    }

    const app = express()
    // Registered first so requests rejected by a guard or by the auth check, which
    // answer without ever reaching a tool, still produce a log line.
    app.use(createRequestLogger(logger, limits, config.http.path, config.http.authToken !== undefined))
    app.use(guarded)
    return app
}

/**
 * Mirrors the SDK's own defaults: a loopback bind with no explicit list checks
 * against `localhost`, `127.0.0.1` and `[::1]`. Resolving them here means the
 * list that is enforced and the list named in a rejection are the same one.
 */
function resolveGuardLimits(http: HttpConfig): GuardLimits {
    if (!isLoopbackHost(http.host)) {
        return { host: http.allowedHosts, origin: http.allowedOrigins }
    }

    return {
        host: http.allowedHosts ?? localhostAllowedHostnames(),
        origin: http.allowedOrigins ?? localhostAllowedOrigins(),
    }
}

function describeGuards(config: ServerConfig, limits: GuardLimits): string {
    const auth = config.http.authToken === undefined ? 'disabled' : 'bearer token required'
    return [
        `logging ${config.logLevel}`,
        `auth ${auth}`,
        `host check ${describeLimit(limits.host)}`,
        `origin check ${describeLimit(limits.origin)}`,
    ].join('; ')
}

function describeLimit(limit: string[] | undefined): string {
    return limit === undefined ? 'off' : limit.join(',')
}

/**
 * One summary line per request at `info`, plus the header set at `debug`. The
 * summary is written when the response ends, so it can state the status and the
 * auth outcome; a client that disconnects early still gets one.
 */
function createRequestLogger(
    logger: Logger,
    limits: GuardLimits,
    endpointPath: string,
    authRequired: boolean,
): RequestHandler {
    let issued = 0

    return (req, res, next) => {
        issued += 1
        const id = issued
        const method = req.method
        const path = req.path
        const startedAt = performance.now()

        logger.debug(`#${id} received ${method} ${path}${describeIncoming(req)}`)

        let recorded = false
        const record = (interrupted: boolean): void => {
            if (recorded) return
            recorded = true

            const status = res.statusCode
            const durationMs = Math.round(performance.now() - startedAt)
            const block = describeBlock({ status, host: req.headers.host, origin: req.headers.origin, limits })
            // The guards answer before the bearer gate runs, so a request they
            // rejected never had its token looked at.
            const auth = diagnoseRequest({
                path,
                endpointPath,
                authorization: req.headers.authorization,
                required: authRequired,
                blocked: block.blocked !== undefined,
                status,
            })

            const summary = [`#${id}`, method, path, String(status), `${durationMs}ms`, `auth=${auth.outcome}`]
            if (req.headers.host !== undefined) summary.push(`host=${quote(req.headers.host)}`)
            if (req.headers.origin !== undefined) summary.push(`origin=${quote(req.headers.origin)}`)
            if (block.blocked !== undefined) summary.push(`blocked=${block.blocked}`)
            if (interrupted) summary.push('client=closed')
            logger.info(summary.join(' '))

            // A guard explains itself first: when a 403 came from the `Host` or
            // `Origin` check the bearer token was never evaluated, so blaming the
            // token would send the reader to the wrong setting.
            const diagnosis = block.blocked === undefined ? auth : block
            if (diagnosis.reason !== undefined) logger.info(`#${id} reason=${quote(diagnosis.reason)}`)
            if (diagnosis.hint !== undefined) logger.info(`#${id} hint=${quote(diagnosis.hint)}`)
        }

        res.once('finish', () => record(false))
        res.once('close', () => record(true))
        next()
    }
}

function describeIncoming(req: Request): string {
    const parts: string[] = []
    if (req.headers.host !== undefined) parts.push(`host=${quote(req.headers.host)}`)
    if (req.headers.origin !== undefined) parts.push(`origin=${quote(req.headers.origin)}`)
    parts.push(`auth=${req.headers.authorization === undefined ? 'absent' : 'present'}`)
    if (req.headers['content-type'] !== undefined) parts.push(`content-type=${quote(req.headers['content-type'])}`)
    if (req.headers.accept !== undefined) parts.push(`accept=${quote(req.headers.accept)}`)
    return ` ${parts.join(' ')}`
}

/** Keeps a value with spaces readable without letting it split the line. */
function quote(value: string): string {
    return /\s/.test(value) ? JSON.stringify(value) : value
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
