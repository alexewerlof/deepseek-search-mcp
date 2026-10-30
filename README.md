# DeepSeek Search MCP

An MCP server that gives a model two tools:

| Tool | What it does |
| --- | --- |
| `deepseek_search` | Web search through DeepSeek's search engine; returns ranked results with title, URL, date and summary |
| `deepseek_fetch` | Fetches one page and returns its title and content as Markdown |

It speaks **Streamable HTTP**, so the MCP host does not have to run on the same
machine as the server. Setup for two hosts is documented below: [LM Studio](#lm-studio)
and [Jan](#jan), both running on a second machine.

Written in TypeScript and executed directly by Node.js 24 — no build step, no
transpiler in the loop.

## Requirements

- Node.js 24 or newer (`node --version`), or Podman/Docker for the
  [container](#container)
- A DeepSeek API key with credit for the Search and Fetch APIs

## Install

```bash
npm install
```

## Configure

The server needs **two** credentials, and they are deliberately different:

| Credential | Where it lives | What it is for |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | On the MCP server only | Pays for DeepSeek Search and Fetch calls |
| `MCP_AUTH_TOKEN` | On the server **and** in LM Studio's `mcp.json` | Proves LM Studio is allowed to call this server |

The DeepSeek key never travels over MCP. If someone reads LM Studio's config, they
get a token that can call these two read-only tools — not a key that can spend
your account balance.

```bash
cp .env.example .env
# then edit .env
openssl rand -hex 32        # paste the result as MCP_AUTH_TOKEN
```

`.env` is gitignored. `npm start` loads it through Node's own
`--env-file-if-exists=.env`, so the file is optional: an MCP host or container that
passes environment variables needs no file at all. Node does not overwrite a
variable that is already set, so a one-off override is easy:

```bash
DEEPSEEK_API_KEY=sk-... npm start
```

npm runs scripts from the package root, so the file is found regardless of where
you invoke `npm start`. To use a different file, call node yourself:

```bash
node --env-file=prod.env src/main.ts
```

Two details of Node's parser differ from most dotenv libraries: a `#` starts a
comment anywhere on the line, so quote a value that contains one
(`MCP_AUTH_TOKEN="ab#cd"`), and values are not expanded, so `$HOME` stays literal.

### Running across the network

A loopback-only setup needs nothing else. To accept connections from another
machine, set:

```dotenv
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=8765
MCP_AUTH_TOKEN=<32+ random characters>
MCP_ALLOWED_HOSTS=198.51.100.10,server.example
```

`MCP_ALLOWED_HOSTS` is not optional: binding off loopback disables the built-in
`Host` header protection, so the server refuses to start without an explicit list.
This is what stops DNS rebinding, where a malicious web page resolves its own
domain to your server's address.

Every address in this README comes from a range reserved for documentation —
`198.51.100.0/24` ([RFC 5737](https://www.rfc-editor.org/rfc/rfc5737)) and the
`.example` TLD ([RFC 2606](https://www.rfc-editor.org/rfc/rfc2606)) — so none of
them points at a real machine. Substitute the address and name you use; keep them
out of this file if you send changes upstream.

## Run

```bash
npm start
```

```
deepseek-search-mcp 0.1.0 listening on http://0.0.0.0:8765/mcp
Warning: this endpoint speaks plain HTTP. ...
```

Logs go to stderr. Check it is reachable from the machine running LM Studio:

```bash
curl -i http://198.51.100.10:8765/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A `200` listing `deepseek_search` and `deepseek_fetch` means the transport and the
token both work. A `401` means the token does not match; a `403` means the
`Host` header is not in the allowlist.

## Container

The image has no `.env`, and that is on purpose: a key baked into a layer stays
readable in `podman history` and `podman save` long after you think you rotated
it. All configuration arrives at run time, through the variables below.

```bash
podman build -t deepseek-search-mcp .
```

`docker` works the same way. The image binds `0.0.0.0` because a container's
loopback is not reachable through a published port — and that non-loopback bind
is exactly what makes `MCP_AUTH_TOKEN` and `MCP_ALLOWED_HOSTS` mandatory. The
server refuses to start without them rather than expose an open endpoint:

```bash
openssl rand -hex 32        # generate once; the same value goes in the client's config

podman run -d --name deepseek-search-mcp \
  -p 8765:8765 \
  -e DEEPSEEK_API_KEY=sk-... \
  -e MCP_AUTH_TOKEN=<paste-the-generated-token> \
  -e MCP_ALLOWED_HOSTS=198.51.100.10,localhost \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  deepseek-search-mcp
```

The token is a credential, not something to regenerate per start: the container
and the MCP host must agree on it.

`MCP_ALLOWED_HOSTS` must list every name a client will put in the `Host` header:
the address or hostname the MCP host dials from the network, plus `localhost` if
you also smoke-test from the server machine. A missing entry is a `403`, never a
silent fallback.

`--read-only` is safe because the process writes only to stderr; nothing touches
the filesystem after startup.

To keep the key out of shell history, hand the variables to the engine from a
file instead. This is the *engine's* `--env-file`, unrelated to Node's flag of
the same name:

```bash
umask 077
printf 'DEEPSEEK_API_KEY=sk-...\n' > .env.container

podman run -d --name deepseek-search-mcp \
  -p 8765:8765 --env-file .env.container \
  -e MCP_AUTH_TOKEN=<paste-the-generated-token> \
  -e MCP_ALLOWED_HOSTS=198.51.100.10,localhost \
  deepseek-search-mcp
```

Keep that file to plain `KEY=value` lines — no comments, no quotes. Podman and
docker parse a slightly different subset than Node does, and the plain form
reads the same everywhere. `podman secret` is stricter still if the value should
stay out of the container environment entirely.

Verify it with the [`curl` check above](#run) from another machine, then:

```bash
podman stop deepseek-search-mcp     # SIGTERM reaches node, exit code 0
podman logs deepseek-search-mcp     # startup line and request errors, on stderr
```

## LM Studio

LM Studio is an MCP host from 0.3.17 onward. It reads `mcp.json` (Cursor
notation), editable in-app:

1. Open the **Program** tab in the right-hand sidebar.
2. Choose **Install → Edit mcp.json**.
3. Add the entry below, then **fully quit and relaunch LM Studio**. Closing the
   window is not enough.

```json
{
    "mcpServers": {
        "deepseek-search": {
            "url": "http://198.51.100.10:8765/mcp",
            "headers": {
                "Authorization": "Bearer <MCP_AUTH_TOKEN>"
            }
        }
    }
}
```

Replace the host and port with the values from your `.env`, and the token with the
one you generated. `url` must include the `/mcp` path — pointing it at the bare
host will connect and then fail to find a server.

Then start a chat, enable the `deepseek-search` integration for that chat, and ask
something that requires the web:

- "What did DeepSeek release most recently? Cite the URLs."
- "Fetch https://example.com and summarize it."

### Notes specific to LM Studio

- `mcp.json` is **plaintext**. Run `chmod 600` on it, and do not sync it or paste
  it into a chat. LM Studio only stores tokens securely for OAuth-backed
  integrations, which need an authorization server; for a personal server, a
  dedicated revocable token is the proportionate choice.
- LM Studio does not inject environment variables into servers on other machines,
  so any per-client secret has to arrive as an HTTP header.
- Local models can overflow their context quickly. The defaults (5 results, no
  page content) are chosen for that. Ask for `need_content` only when the summary
  is not enough.
- If the tools never appear, check the server's stderr. An unreachable host and a
  wrong path look identical from inside LM Studio.

## Jan

Jan (desktop) is also an MCP host, and it configures servers through a form
rather than a JSON file:

1. Open **Settings → MCP Servers**.
2. Click **+** to add a server.
3. Fill in the fields below.

| Field | Value |
| --- | --- |
| Server Name | `DeepSeek` |
| Transport Type | `HTTP` |
| URL | `http://198.51.100.10:8765/mcp` |
| Headers | `Authorization: Bearer <MCP_AUTH_TOKEN>` |
| Timeout | `30` |

Replace the host and port with the values from your `.env`, and `<MCP_AUTH_TOKEN>`
with the token you generated. As with LM Studio, the URL must include the `/mcp`
path — a bare host connects and then finds no server.

Then start a chat with a model that supports tool calling and ask something that
needs the web:

- "What did DeepSeek release most recently? Cite the URLs."
- "Fetch https://example.com and summarize it."

### Notes specific to Jan

- Jan asks for approval before each tool call, in a panel inside the tool card.
  **Settings → MCP Servers → Allow All MCP Tool Permissions** pre-approves them.
- The model must have tool calling enabled. Jan's docs point at the model's
  capability settings for local models; a model without tool support ignores the
  server entirely, however well the connection works.
- `Timeout` is the client-side limit, in the same ballpark as the server's own
  `DEEPSEEK_TIMEOUT_MS` default of 30 seconds. A value below that will cut off a
  slow page fetch before the server answers.
- Header values are stored in Jan's settings on the client machine, so the same
  rule as LM Studio applies: use the dedicated `MCP_AUTH_TOKEN`, never the
  DeepSeek key.

## Tools

### `deepseek_search`

| Argument | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | 1–128 characters; supports `site:`, `-site:`, `"phrase"`, `lang:`, `after:`, `before:` |
| `count` | integer | 5 | 1–50; the API's own default is 10 |
| `need_content` | boolean | `false` | Also return page text, capped per result |
| `ori_question` | string | — | The user's original question, when the query alone is ambiguous |

Returns a text block with title, URL, metadata line, and summary (or snippet for
older results), plus structured metadata for the same results. Long content and
long result sets are truncated with a visible marker.

### `deepseek_fetch`

| Argument | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | string | required | HTTP or HTTPS, ≤8192 characters, no embedded credentials |

Returns `URL`, `Title`, the original content length, and the page as Markdown,
capped by `DEEPSEEK_FETCH_MAX_CHARS`.

## Cost and limits

- Billed per **successful** request: $0.75 per 1,000 Search and per 1,000 Fetch.
  Failed calls, empty search results and timeouts are free.
- `count` does not change the price, so a larger result set is not more expensive
  — only more context.
- Rate limits per account: Search 100 QPS, Fetch 25 QPS, plus a per-domain limit
  on Fetch. Exceeding them returns `429`.
- The server retries only `408`, `429` and `5xx`, at most twice, with exponential
  backoff and jitter.

## Development

| Command | Purpose |
| --- | --- |
| `npm run fmt` | Format with the repo Prettier config |
| `npm run lint` | ESLint, recommended presets only |
| `npm run typecheck` | `tsc --noEmit`, including the erasable-syntax check |
| `npm run test:unit` | Offline tests: parsing, config, retry matrix, tools, HTTP auth |
| `npm run test:live` | Real DeepSeek calls; skipped without a key, billable with one |

Repository layout, conventions and the documentation-sync rules are in
[AGENTS.md](AGENTS.md) and the per-directory `AGENTS.md` files. Design background
and API facts live in [.agents/skills](.agents/skills).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `deepseek-search-mcp cannot start: Missing DEEPSEEK_API_KEY` | No key in the environment, and no `.env` for `npm start` to load |
| `Binding to 0.0.0.0 exposes this server to the network` | Non-loopback bind without `MCP_AUTH_TOKEN` and `MCP_ALLOWED_HOSTS`; the container sets `0.0.0.0` by default |
| Container exits immediately | Same as above: read `podman logs`, it prints the missing variable |
| `MCP_AUTH_TOKEN must be at least 32 characters` | Token too short; `openssl rand -hex 32` |
| `401` from curl, LM Studio or Jan | Token mismatch, or the client sends no `Authorization` header |
| `403` | `MCP_ALLOWED_HOSTS` does not contain the hostname the client used |
| Jan shows the server as connected but offers no tools | URL missing `/mcp`, or the selected model has no tool support |
| Tools listed but every call fails with 402 | DeepSeek balance is empty |
| `429` | Rate limit; wait, or reduce parallelism |
| Context overflow after one call | Lower `DEEPSEEK_SEARCH_MAX_RESULTS` or `DEEPSEEK_SEARCH_TEXT_CHARS` |
| `404` on fetch | The page blocks bots, is not HTML, or has no extractable content |

## Security

- Loopback bind by default; a public bind requires a token and a host allowlist.
- Tokens are compared in constant time.
- Plain HTTP exposes the bearer token to anyone on the path. Put Caddy or nginx in
  front for TLS, or use WireGuard, Tailscale or an SSH tunnel. A
  `Host` allowlist does not encrypt anything.
- The DeepSeek key is read once at startup and is never logged, echoed or passed
  to tool arguments.
