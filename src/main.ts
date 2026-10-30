import { ConfigError, isLoopbackHost, loadConfig } from './config.ts'
import { SERVER_NAME, SERVER_VERSION } from './constants.ts'
import { DeepSeekClient } from './deepseek/client.ts'
import { startHttpServer, type RunningHttpServer } from './http.ts'

const UNENCRYPTED_TRANSPORT_WARNING =
    'Warning: this endpoint speaks plain HTTP. Terminate TLS in front of it (or use a WireGuard/Tailscale/SSH tunnel) if the network is not trusted.'

async function main(): Promise<void> {
    const config = loadConfig()
    const client = new DeepSeekClient({
        apiKey: config.deepseek.apiKey,
        baseUrl: config.deepseek.baseUrl,
        timeoutMs: config.deepseek.timeoutMs,
        maxRetries: config.deepseek.maxRetries,
    })

    const server = await startHttpServer(config, {
        client,
        search: config.deepseek.search,
        fetch: config.deepseek.fetch,
    })

    // stdout stays empty: nothing here is allowed to write to it.
    console.error(`${SERVER_NAME} ${SERVER_VERSION} listening on ${server.url}`)
    if (!isLoopbackHost(config.http.host)) console.error(UNENCRYPTED_TRANSPORT_WARNING)

    registerShutdown(server)
}

function registerShutdown(server: RunningHttpServer): void {
    const shutdown = (): void => {
        void server.close().then(
            () => process.exit(0),
            (error: unknown) => {
                console.error(`${SERVER_NAME} failed to shut down cleanly: ${String(error)}`)
                process.exit(1)
            },
        )
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
}

function describeStartupError(error: unknown): string {
    if (error instanceof ConfigError) return `${SERVER_NAME} cannot start: ${error.message}`
    if (error instanceof Error) return `${SERVER_NAME} cannot start: ${error.message}`
    return `${SERVER_NAME} cannot start: ${String(error)}`
}

void main().catch((error: unknown) => {
    console.error(describeStartupError(error))
    process.exitCode = 1
})
