# AGENTS.md — repository guide

A Model Context Protocol server that exposes the DeepSeek Search and Fetch APIs as
two tools, over Streamable HTTP, so a remote LM Studio (or any MCP host) can call
them. TypeScript runs directly on Node.js 24; there is no build step.

Start here, then read the `AGENTS.md` in the folder you are about to change.

## Commands

| Command | What it does | When |
| --- | --- | --- |
| `npm start` | Runs the HTTP server from `src/main.ts`, loading `.env` when present | Manual verification |
| `npm run fmt` | Prettier, using the repo config | Before every commit |
| `npm run lint` | ESLint (flat config, recommended presets only) | Before every commit |
| `npm run typecheck` | `tsc --noEmit` | Before every commit |
| `npm run test:unit` | Offline tests, no network, no cost | Before every commit |
| `npm run test:live` | Real DeepSeek calls; skips without a key | Only when changing API interaction |

Order for a change: `fmt` → `lint` → `typecheck` → `test:unit`.

## Non-negotiables

1. **The DeepSeek API key never leaves this process.** It is read from
   `process.env` (filled by the host, a container's `-e`, or Node's `--env-file`).
   Never accept it as a tool argument, never forward a client token upstream,
   never log it, never echo it.
2. **Nothing writes to stdout.** All logging is `console.error`. stdout stays
   reserved so the process can gain a stdio mode without corruption, and so
   container logs never interleave with protocol data.
3. **No build step.** Node strips types at runtime, so only erasable TypeScript
   is allowed: no `enum`, no runtime `namespace`, no parameter properties, no
   decorators. Import with explicit `.ts` extensions and use `import type` for
   types. `tsconfig.json` is for the typechecker only.
4. **Prettier config is authoritative.** `.prettierrc.json` sets 4 spaces, single
   quotes, no semicolons, 120 columns. Do not hand-format against it.
5. **ESLint stays on defaults.** `eslint.config.mjs` runs `@eslint/js` recommended
   plus `typescript-eslint` recommended. Do not add rule overrides or disable
   rules to make a build pass; fix the code.
6. **No I/O at import time.** `createServer()` and the HTTP app are factories.
   Configuration loading and `listen()` happen in `src/main.ts` only.
7. **Fail closed on exposure.** A non-loopback bind without `MCP_AUTH_TOKEN` and
   `MCP_ALLOWED_HOSTS` must refuse to start.
8. **No personal data in tracked files.** Examples use the documentation ranges
   reserved by RFC 5737 (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and
   the RFC 2606 `.example` TLD. Never put a real hostname, LAN address, machine
   name, person's name, or email in code, tests, docs, or fixtures. `.env` is
   untracked and is the only place a real value belongs.
9. **Never bake configuration into the image.** `.dockerignore` excludes `.env`;
   the container is configured at run time through `-e` or `--env-file`. A key in
   a layer survives in `history`/`save` output and cannot be rotated away.

## Directory map

| Path | What lives there | Local guide |
| --- | --- | --- |
| `src/` | Server source: config, auth, HTTP wiring, DeepSeek client | [src/AGENTS.md](src/AGENTS.md) |
| `src/deepseek/` | DeepSeek API constants, schemas, errors, client, formatting | [src/deepseek/AGENTS.md](src/deepseek/AGENTS.md) |
| `src/tools/` | The two MCP tools and their output contracts | [src/tools/AGENTS.md](src/tools/AGENTS.md) |
| `test/` | Offline unit tests and opt-in live checks | [test/AGENTS.md](test/AGENTS.md) |
| `.agents/skills/` | Repo skills: MCP design, TS SDK recipes, DeepSeek API facts | [.agents/skills/AGENTS.md](.agents/skills/AGENTS.md) |
| `.env` (untracked) | Live credentials; gitignored | — |
| `.env.example` | Documented list of every supported variable | — |
| `Dockerfile`, `.dockerignore` | Container image: dependencies and `src/` only, never config | — |
| `README.md` | Human onboarding: setup, container, LM Studio and Jan configuration, tool reference | — |

## Runtime shape

```
LM Studio (another machine)
    │  POST /mcp  + Authorization: Bearer <MCP_AUTH_TOKEN>
    ▼
express app  ──requireBearerAuth──►  createMcpHandler ──►  createServer()
                                            │                    │
                                            │            deepseek_search / deepseek_fetch
                                            │                    │
                                            └────────────────────┴─► DeepSeekClient
                                                                     │ Bearer <DEEPSEEK_API_KEY>
                                                                     ▼
                                                        api.deepseek.com/v1/tools/*
```

## Configuration

All variables are documented in `.env.example`. The process reads `process.env`
only: `npm start` passes `--env-file-if-exists=.env`, so Node loads the optional
file before any module runs, and a container passes the same names with `-e` or
the engine's `--env-file`. Node never overwrites a variable that is already set,
so the environment wins over the file. For a different file, run node directly:

```bash
node --env-file=prod.env src/main.ts
```

| Variable | Default | Notes |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | — | Required |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Override for a proxy |
| `DEEPSEEK_TIMEOUT_MS` | `30000` | Per request |
| `DEEPSEEK_MAX_RETRIES` | `2` | Retryable failures only |
| `DEEPSEEK_SEARCH_MAX_RESULTS` | `5` | Default tool `count` |
| `DEEPSEEK_SEARCH_CONTENT_CHARS` | `2000` | Per-result content cap |
| `DEEPSEEK_SEARCH_TEXT_CHARS` | `12000` | Whole text block cap |
| `DEEPSEEK_FETCH_MAX_CHARS` | `20000` | Fetch text cap |
| `MCP_HTTP_HOST` | `127.0.0.1` | Non-loopback requires the next two |
| `MCP_HTTP_PORT` | `8765` | `0` picks a free port |
| `MCP_HTTP_PATH` | `/mcp` | |
| `MCP_AUTH_TOKEN` | — | ≥32 characters |
| `MCP_ALLOWED_HOSTS` | — | Comma-separated hostnames/IPs |
| `MCP_ALLOWED_ORIGINS` | — | Only for browser clients |

## Keeping these files in sync

Documentation drift is a bug. When you change behaviour, update the guide that
describes it **in the same change**:

| If you change… | Update |
| --- | --- |
| A tool name, argument, default or output shape | `src/tools/AGENTS.md`, the tools table in `README.md` |
| The setup steps for a supported MCP host | that host's section in `README.md`, and the map row above if a new host is added |
| Retry policy, error mapping or output caps | `src/deepseek/AGENTS.md`, `.agents/skills/deepseek-search-fetch/references/errors-limits-billing.md` |
| An environment variable | the table above, `.env.example`, the README configuration section |
| Transport, auth or binding rules | `src/AGENTS.md`, `.agents/skills/mcp-server-design/references/remote-http-hosting.md` |
| An npm script | the commands table above, the README development section |
| The image, its build context, or the defaults it sets | the README container section |
| A documentation example containing a host, IP or name | keep it inside the RFC 5737 / RFC 2606 ranges |
| Add or remove a directory | the directory map above, plus the new folder's `AGENTS.md` |
| A skill's workflow | its `SKILL.md` and `.agents/skills/AGENTS.md` if the layout changed |

Create a new `AGENTS.md` only when a folder owns real, stable conventions of its
own. A file that restates its parent is worse than none: it will drift unnoticed.

## Definition of done

- [ ] `npm run fmt`, `npm run lint`, `npm run typecheck`, `npm run test:unit` pass
- [ ] New behaviour has a test, or a stated reason it cannot have one
- [ ] The nearest `AGENTS.md` (and the README or skill it points to) still describes the code
- [ ] No secret, token, or `.env` content appears in code, tests, logs or docs
- [ ] No temporary files, debug logging, or commented-out code left behind
