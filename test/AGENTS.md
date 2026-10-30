# test/AGENTS.md

Two suites with deliberately different costs. Keep them separate.

| Path | Script | Network | Cost |
| --- | --- | --- | --- |
| `test/unit/**/*.test.ts` | `npm run test:unit` | No | Free |
| `test/live/checks.ts` | `npm run test:live` | Yes | Billable |

`test:unit` passes a glob, so `test/live/` is never part of it. Note that a bare
`node --test` *would* pick up everything under `test/`, including the live file —
always use the scripts.

## Unit tests

| File | Covers |
| --- | --- |
| `config.test.ts` | Defaults and every refusal path (missing key, short token, public bind) |
| `auth.test.ts` | Token match, mismatch, length mismatch, expiry populated |
| `client.test.ts` | Request mapping, retry matrix, timeout wording, response validation |
| `format.test.ts` | Truncation, summary-over-snippet, empty results |
| `tools.test.ts` | Real MCP surface over `InMemoryTransport`: happy path, schema rejection, `isError` |
| `http.test.ts` | Real socket: 401/200, wrong token, foreign `Host` → 403 |

Rules:

1. **No real network, no real waiting.** Inject `fetch`, `sleep` and `random` into
   `DeepSeekClient`; pass an explicit `env` to `loadConfig` so tests never depend
   on the ambient environment.
2. **Assert on observable behaviour** — request URL, headers, body, retry count,
   tool result — not on internal call order.
3. **Drive the real MCP surface** at least once per tool. `createServer()` plus
   `InMemoryTransport.createLinkedPair()` is the cheapest way.
4. **Two traps in HTTP tests.** `fetch` silently drops a `Host` header, so use
   `node:http`; and a 2025-era client receives `text/event-stream`, so parse the
   last `data:` line instead of calling `response.json()`.
5. **Clean up servers** in `t.after(() => server.close())`; a leaked listener keeps
   the test process alive.
6. **Port 0** for tests. Read the real port back from the running server rather
   than assuming a fixed one.
7. **Fixtures use reserved addresses only.** `198.51.100.0/24` and
   `server.example` (RFC 5737 / RFC 2606), never a real host, LAN address or
   machine name. A test fixture is a tracked file like any other.

## Live checks

- Skip themselves when no key is configured, using the runner's `{ skip }`
  option; the reason names the missing variable.
- Cover one search, one fetch, and one negative case that costs nothing (an
  invalid key must produce 401 and no retry).
- Never assert on exact titles or result counts: the web changes.

## Adding a test

Put it in `test/unit/` and name it `*.test.ts`, or it will not run. If a helper is
shared, add a non-test file (for example `support.ts`) so the runner does not try
to execute it as a suite.

## Related

- [../AGENTS.md](../AGENTS.md)
- [../src/AGENTS.md](../src/AGENTS.md)
