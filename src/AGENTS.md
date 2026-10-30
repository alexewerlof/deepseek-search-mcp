# src/AGENTS.md

Server composition. Everything here is imported by `main.ts` or by a test; none
of it performs I/O at import time.

## Module graph

```
main.ts ──► config.ts ──► constants.ts (env names, defaults)
   ├──────► http.ts ──► auth.ts
   │            └─────► server.ts ──► tools/search.ts
   │                        │        └ tools/fetch.ts
   │                        └──────► deepseek/client.ts ──► schemas.ts, errors.ts, constants.ts
   └──────► deepseek/client.ts
```

## What each file owns

| File | Responsibility |
| --- | --- |
| `constants.ts` | Server identity, environment variable names, HTTP defaults, auth limits |
| `config.ts` | Validated configuration, refusal to expose an unauthenticated endpoint |
| `auth.ts` | Static bearer token verifier, constant-time comparison |
| `http.ts` | Express app, DNS rebinding guards, bearer gate, listener, graceful close |
| `server.ts` | `createServer()` factory: registers both tools on a fresh `McpServer` |
| `main.ts` | Loads config, builds the client, starts the server, handles signals |

## Invariants

1. **No I/O at import time.** Nothing may read a file, open a socket, or call
   `process.exit` at module scope. Tests import these modules directly.
2. **`createServer()` is per request.** The HTTP handler calls the factory for
   every request. Keep it cheap: no connection pools, no file reads, no logging.
3. **Tool handlers never write to stdout or exit the process.** They return a
   result or throw; the transport decides what happens next.
4. **Configuration is validated before the port opens**, so a bad env var fails
   with a sentence rather than a partially running server.
5. **Only loopback may run without a token.** `config.ts` enforces it; do not
   weaken that check to make a local test easier.
6. **`allowedHosts` is required for a non-loopback bind.** Binding elsewhere turns
   off the adapter's built-in `Host`/`Origin` defaults.
7. **Configuration is read from `process.env` only.** `loadConfig` never opens a
   file; `npm start` passes `--env-file-if-exists=.env` and Node loads it before
   any module runs. This is what lets the container image ship without config.

## Adding a new tool

1. Create `src/tools/<name>.ts` exporting `<NAME>_TOOL_NAME`,
   `register<Name>Tool(server, client, options)` and a `…ToolOptions` type.
2. Register it in `src/server.ts` and add its options to `CreateServerOptions`.
3. If it needs configuration, add the variable to `src/constants.ts`
   (`ENV_VARS`), read and validate it in `src/config.ts`, document it in
   `.env.example`, `AGENTS.md` and `README.md`.
4. Add a tool test in `test/unit/` and update `src/tools/AGENTS.md` and the
   README tools table.

## Adding an HTTP behaviour

Anything touching auth, binding, or `Host`/`Origin` validation also needs a test in
`test/unit/http.test.ts`. `fetch` strips the `Host` header, so that test must use
`node:http` directly.

## Related

- [../AGENTS.md](../AGENTS.md) — commands, non-negotiables, sync rules
- [deepseek/AGENTS.md](deepseek/AGENTS.md) — API client rules
- [tools/AGENTS.md](tools/AGENTS.md) — tool contracts
