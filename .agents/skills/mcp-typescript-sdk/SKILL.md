---
name: mcp-typescript-sdk
description: Recipes for the official MCP TypeScript SDK v2 — building a server factory, registering tools and output schemas with zod 4, serving over stdio or Streamable HTTP with the Express and Node adapters, adding bearer-token auth, and testing with an in-memory transport or a real HTTP request. Use when writing or debugging TypeScript MCP server code, choosing SDK packages and entry points, wiring transports, or setting up MCP tests.
---

# MCP TypeScript SDK v2

The SDK is split into packages. Install only what you use:

| Package | Provides |
| --- | --- |
| `@modelcontextprotocol/server` | `McpServer`, `createMcpHandler`, schemas, auth helpers |
| `@modelcontextprotocol/server/stdio` | `serveStdio`, `StdioServerTransport` |
| `@modelcontextprotocol/client` | `Client`, transports, `InMemoryTransport` |
| `@modelcontextprotocol/express` | `createMcpExpressApp`, `requireBearerAuth` |
| `@modelcontextprotocol/node` | `toNodeHandler`, host/origin guards for `node:http` |

`zod` is a peer dependency; use `^4` and import as `import * as z from 'zod/v4'`.

## 1. Build a factory, not a singleton

Every entry point calls your factory once per connection (stdio) or once per
request (HTTP). The factory must be cheap and side-effect free:

```ts
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'

export function createServer(options: { client: ApiClient }): McpServer {
    const server = new McpServer({ name: 'my-server', version: '0.1.0' })

    server.registerTool(
        'lookup_thing',
        {
            title: 'Look up a thing',
            description: 'Find one thing by id. Use when the user names an id.',
            inputSchema: z.object({
                id: z.string().describe('Opaque id, for example "abc-123".'),
                limit: z.number().int().min(1).max(50).default(5).describe('Maximum matches.'),
            }),
            outputSchema: z.object({ id: z.string(), found: z.boolean() }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async ({ id, limit }) => {
            const thing = await options.client.lookup(id, limit)
            return {
                content: [{ type: 'text', text: thing.summary }],
                structuredContent: { id: thing.id, found: true },
            }
        },
    )

    return server
}
```

`inputSchema` is one zod schema. From it the SDK derives the advertised JSON
Schema, validates incoming arguments before your handler runs, and infers the
handler's parameter types.

Return shape:

- `content` — array of blocks (`text`, `image`, `audio`, `resource`,
  `resource_link`).
- `structuredContent` — optional, validated against `outputSchema`.
- `isError` — set `true` for a failure the model should read and react to.
  Thrown exceptions are protocol errors; prefer `isError` for expected failures.

## 2. Serve over stdio

```ts
import { serveStdio } from '@modelcontextprotocol/server/stdio'

void serveStdio(() => createServer(options), {
    onerror: (error) => console.error('server error:', error),
})
console.error('listening on stdio')
```

`serveStdio` owns the transport and negotiates the protocol revision per
connection. Its default `legacy: 'serve'` also answers 2025-era clients; leave it
alone unless you want to reject them.

Never write to stdout: it is the JSON-RPC channel. Use `console.error`.

## 3. Serve over Streamable HTTP

```ts
import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'

const handler = createMcpHandler(() => createServer(options))
const app = createMcpExpressApp({ host, allowedHosts, allowedOrigins })
const node = toNodeHandler(handler)

app.all('/mcp', requireBearerAuth({ verifier }), (req, res) => void node(req, res, req.body))
app.listen(port, host)
```

- `createMcpExpressApp` is Express with `express.json()` and loopback `Host`/
  `Origin` validation already applied. Binding to a non-loopback address turns
  that default off — pass `allowedHosts` (and `allowedOrigins` if browsers call
  it).
- `express.json()` consumes the body, so pass `req.body` as the third argument to
  `toNodeHandler`; otherwise the adapter reads an empty stream.
- `createMcpHandler(factory)` returns `{ fetch, close, notify, bus }`.
  `handler.fetch(request)` is a web-standard entry point, which is what makes
  in-process tests possible.

## 4. Add bearer auth

```ts
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server'

const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
        if (!safeEqual(token, expectedToken)) {
            throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token')
        }
        return { token, clientId: 'host', scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600 }
    },
}
```

Two details that cost an afternoon each if missed:

1. **`expiresAt` is required.** The gate answers `401 invalid_token` for a token
   whose `expiresAt` is unset, even when the verifier approved it.
2. **Compare in constant time.** Pre-check the byte length, then
   `crypto.timingSafeEqual`.

The SDK attaches the verified `AuthInfo` to the request; tool handlers read it as
`ctx.http?.authInfo` (undefined over stdio).

## 5. Test the real surface

In-memory pair (2025-era handshake):

```ts
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const server = createServer(options)
await server.connect(serverTransport)

const client = new Client({ name: 'test', version: '0.0.0' })
await client.connect(clientTransport)

const result = await client.callTool({ name: 'lookup_thing', arguments: { id: 'abc' } })
await client.close()
await server.close()
```

HTTP without a socket: pass `handler.fetch` as the client transport's `fetch`
option. With a socket: start the server on port 0 and use plain `fetch`.

Assert on `structuredContent` and `isError`; schema rejections arrive as ordinary
results with `isError: true`, not thrown exceptions.

## 6. Constraints of running TypeScript directly on Node

See [references/node24-typescript.md](references/node24-typescript.md). In short:
erasable syntax only, `.ts` extensions in imports, `import type`, and no reliance
on `tsconfig.json` at runtime.

## Sources

- <https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server.md>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-server.md>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/express.md>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md>
