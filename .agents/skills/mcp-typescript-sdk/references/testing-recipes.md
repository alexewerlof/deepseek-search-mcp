# Testing an MCP server

Three layers, cheapest first. Mix them: fast unit tests for logic, one
integration test for the real MCP surface, and an opt-in test for anything that
costs money or needs the network.

## Layer 1: pure logic, no MCP involved

Keep request building, response parsing, retry policy and formatting in plain
functions or a client class that accepts an injected `fetch`. Then test them with
`node:test` and `node:assert/strict` — no server, no sockets, no waiting.

```ts
const client = new DeepSeekClient({
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.test',
    timeoutMs: 1_000,
    maxRetries: 1,
    fetch: async (url, init) => jsonResponse({ results: [] }),
    sleep: async () => {},        // do not really wait
    random: () => 0,              // deterministic jitter
})
```

Injecting `sleep`, `random` and `fetch` makes retry behaviour exactly assertable:
call counts, delays, and which statuses were retried.

## Layer 2: the real MCP surface, no socket

```ts
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await server.connect(serverTransport)

const client = new Client({ name: 'test', version: '0.0.0' })
await client.connect(clientTransport)

const result = await client.callTool({ name: 'my_tool', arguments: { ... } })
```

This exercises registration, schema validation and result encoding — the parts
that break when you rename a tool or change a schema.

Assert:

- `result.structuredContent` for the happy path.
- `result.isError === true` for expected failures.
- That an invalid argument never reaches your client stub (`called === false`).

Close both ends in `t.after()`: `await client.close()` then `await server.close()`.

## Layer 2b: the real HTTP surface, on a socket

Start the server on port 0, read the actual port back, and use plain `fetch`.
Cover at least:

- `401` without a token, `401` with a wrong token, `200` with the right one.
- A foreign `Host` header → `403`.
- `tools/list` contains the tool names.

Two traps:

1. `fetch` silently drops the `Host` header, so a DNS-rebinding test must use
   `node:http` `request` with an explicit `host`.
2. A 2025-era client gets `text/event-stream`, so parse the last `data:` line
   rather than calling `response.json()`.

```ts
async function readRpcPayload(response: Response): Promise<unknown> {
    const body = await response.text()
    if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) return JSON.parse(body)
    const data = body.split('\n').filter((line) => line.startsWith('data:')).at(-1)
    return JSON.parse(data!.slice('data:'.length).trim())
}
```

## Layer 3: live, opt-in, skipped by default

Real API calls cost money and fail for reasons outside the code. Keep them:

- In a file that the default test glob does not match, for example
  `test/live/checks.ts` run by its own `test:live` script.
- Skipped when credentials are absent, using the runner's own skip option:

```ts
const config = tryLoadConfig()
const skip = config === undefined ? 'DEEPSEEK_API_KEY is not configured' : false
test('search returns results', { skip }, async () => { /* ... */ })
```

Include one negative live check that costs nothing — a deliberately invalid key
should produce a 401 and no retry.

## Style

- One behaviour per test, named as a sentence ("rejects a non-HTTP url before
  calling DeepSeek").
- Assert on observable output, not on internal call order you do not control.
- Avoid snapshot tests for prose a model reads; they hide regressions rather than
  catch them.
