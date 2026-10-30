# SDK v2 cheat sheet

Verified against `@modelcontextprotocol/server@2.4.0`, `client@2.4.0`,
`express@2.0.2`, `node@2.1.2`.

## Imports

```ts
import { McpServer, createMcpHandler, OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import * as z from 'zod/v4'
```

## `registerTool(name, config, handler)`

Config fields:

| Field | Purpose |
| --- | --- |
| `title` | Human-readable display name |
| `description` | The model's instructions for when and how to call it |
| `inputSchema` | Zod object schema; validated before the handler |
| `outputSchema` | Zod schema for `structuredContent`; validated on the way out |
| `annotations` | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` |
| `icons` | Optional display icons |
| `scopeChallenge` | Per-operation OAuth scope requirement |

Returns a `RegisteredTool` with `enable()` / `disable()` for dynamic tool lists.

## Handler return values

```ts
// Success
{ content: [{ type: 'text', text: '...' }] }

// Success with machine-readable data
{ content: [{ type: 'text', text: '...' }], structuredContent: { id: 'a' } }

// Expected failure the model should read
{ content: [{ type: 'text', text: 'Account balance is empty (HTTP 402).' }], isError: true }
```

A thrown error is a protocol-level failure; use `isError` for anything the model
could act on.

## Entry points

| Function | Transport | Default legacy posture |
| --- | --- | --- |
| `serveStdio(factory, opts?)` | stdio | `legacy: 'serve'` |
| `createMcpHandler(factory, opts?)` | Streamable HTTP | `legacy: 'stateless'` |

`createMcpHandler` returns `{ fetch, close, notify, bus }`:
`fetch(request, { authInfo? }) => Promise<Response>`.

`toNodeHandler(handler)` adapts it to `(req, res, parsedBody?)`. Pass
`req.body` when a JSON body parser already ran.

`createMcpExpressApp({ host, allowedHosts, allowedOrigins })` returns an Express
app with JSON parsing and loopback host/origin validation applied.

## Auth

```ts
const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
        // return AuthInfo, or throw OAuthError(OAuthErrorCode.InvalidToken, '...')
        return { token, clientId: 'host', scopes: [], expiresAt: secondsSinceEpoch }
    },
}
app.all('/mcp', requireBearerAuth({ verifier, requiredScopes: [] }), route)
```

Gotchas:

- `expiresAt` must be set or every token is rejected as invalid.
- `requireBearerAuth` verifies nothing by itself; the verifier is the whole check.
- The verified value reaches handlers as `ctx.http?.authInfo`, and the factory as
  `ctx.authInfo` in `createMcpHandler((ctx) => ...)`.
- A `WWW-Authenticate` challenge is added automatically on 401/403.

## Client (tests)

```ts
const client = new Client({ name: 'test', version: '0.0.0' })
await client.connect(new InMemoryTransport.createLinkedPair()[0])

const tools = await client.listTools()
const result = await client.callTool({ name: 'x', arguments: { a: 1 } })
await client.close()
```

`InMemoryTransport.createLinkedPair()` is 2025-era only. For the modern era,
drive `handler.fetch` directly or use
`StreamableHTTPClientTransport(url, { fetch })` with
`new Client(info, { versionNegotiation: { mode: 'auto' } })`.

## Protocol-era behaviour to expect

- 2025-era POSTs are answered as `text/event-stream` SSE, even when
  `responseMode: 'json'` is set — that option shapes *modern* exchanges only.
- `legacy: 'reject'` makes an endpoint modern-only and returns an
  unsupported-protocol-version error to old clients.
- `subscriptions/listen` streams are always SSE.
