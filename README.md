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
| `MCP_AUTH_TOKEN` | Shared between the server **and** the client | Proves the client is allowed to call this server |

The credentials live in an `.env` file that's not checked in to the repo.
Initialize it by copying the example:

```bash
cp .env.example .env
```

Then set your [Deepseek API key](https://platform.deepseek.com/api_keys) in `DEEPSEEK_API_KEY`. I recommend creating a unique and dedicated API key for this MCP so you can invalidate it without breaking other integrations to Deepseek (e.g. your IDE or AI agent).

The DeepSeek key never travels over MCP. If someone reads the client's config, they
get a token that can call these two read-only tools — not a key that can spend
your account balance.

```bash
# Generate a random value for MCP_AUTH_TOKEN
openssl rand -hex 32
```

Paste the result as `MCP_AUTH_TOKEN` in the .env

You can also provide the environment variables when starting the server but be warned that the token gets logged in your terminal history:

```bash
DEEPSEEK_API_KEY=sk-... npm start
```

npm runs scripts from the package root, so the file is found regardless of where
you invoke `npm start`. To use a different file, call node yourself:

```bash
node --env-file=prod.env src/main.ts
```

Two details of Node's parser differ from most dotenv libraries:
1. A `#` starts a comment anywhere on the line, so quote a value that contains one
(`MCP_AUTH_TOKEN="ab#cd"`)
2. Values are not expanded, so `$HOME` stays literal.

### Port

By default, the server listens on port `8765`.
You can change that in the `.env` file:

```ini
MCP_HTTP_PORT=8888 #Listen on port 8888
```

### Running across the network

A loopback-only setup needs nothing else. To accept connections from another
machine, set:

```ini
MCP_HTTP_HOST=0.0.0.0
MCP_AUTH_TOKEN=<32+ random characters>
```

Those are the only requirements. `MCP_AUTH_TOKEN` is not optional off loopback:
the server refuses to start without it rather than expose an unauthenticated
endpoint, and it is the control that actually gates a reachable port.

### Host and Origin checks

The MCP specification requires servers to validate the `Origin` header; it says
nothing about `Host`. This server follows that split:

- **The `Origin` guard is always on.** With no configuration it accepts only
  `localhost`, `127.0.0.1` and `[::1]`, which is enough for non-browser clients —
  they send no `Origin` header at all, so the check passes. A browser client is
  rejected until its origin is listed. An Chrome extension's origin is
  `chrome-extension://<extension-id>`, so list either that id or
  `chrome-extension://*` for every extension of that scheme. Setting
  `MCP_ALLOWED_ORIGINS` replaces the loopback defaults: keep
  `localhost,127.0.0.1,[::1]` in the list if a local page also calls the server.
- **The `Host` guard is optional.** Set `MCP_ALLOWED_HOSTS` to the names clients
  put in the `Host` header — the address or hostname they dial, port-agnostic —
  to add DNS-rebinding protection on top of the token. Leaving it unset
  installs no `Host` guard, and the startup line says so. `MCP_ALLOWED_HOSTS=*`
  opts out explicitly, for the case where the unset form looks like an oversight.
  A missing entry is a `403` whose body names `MCP_ALLOWED_HOSTS`.

Entries are matched against the origin's **hostname**, so a full origin with a
scheme and port would never match — `https://server.example:3000` must be written
`server.example`. The only wildcard form is `<scheme>://*`, and only for schemes
other than `http` and `https`. The server checks this at startup and refuses to
start on an entry that could never match (`*`, `https://*`, a full URL, `null`),
because a running server that rejects every browser client looks healthy while
being unusable.

Every rejection is a `403` with a JSON-RPC error body naming the failed check,
the setting that controls it and the value the client sent:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": {
    "code": -32000,
    "message": "Invalid Origin: abcdefghijklmnop",
    "data": {
      "check": "origin",
      "setting": "MCP_ALLOWED_ORIGINS",
      "value": "chrome-extension://abcdefghijklmnop",
      "hint": "add abcdefghijklmnop to MCP_ALLOWED_ORIGINS, or chrome-extension://* for every origin of that scheme"
    }
  }
}
```

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
`Host` header is not in the allowlist, or an `Origin` header is not — read the log
line, it says which one and names the variable to change.

### Debugging requests

Every request produces one summary line on stderr, including requests a guard or
the auth check rejects before any tool runs:

```text
[deepseek-search-mcp] logging info; auth bearer token required; host check 127.0.0.1,localhost,[::1]; origin check 127.0.0.1,localhost,[::1]
[deepseek-search-mcp] #4 POST /mcp 403 1ms auth=not-checked host=127.0.0.1:8765 origin=chrome-extension://abcdefghijklmnop blocked=origin
[deepseek-search-mcp] #4 reason="Invalid Origin: abcdefghijklmnop"
[deepseek-search-mcp] #4 hint="add abcdefghijklmnop to MCP_ALLOWED_ORIGINS, or chrome-extension://* for every origin of that scheme"
```

The summary carries the method, path, status, duration, the `Host` and `Origin`
the client sent, and how the bearer check ended: `disabled`, `none`,
`malformed`, `rejected`, `accepted`, or `not-checked` when a guard or a wrong
path answered first. A rejected request adds `blocked=host` or `blocked=origin`,
the guard's own message, and the setting that fixes it. A request that failed for
some other reason after the token check reports `auth=unknown`, so a failure is
never blamed on the token by default. `client=closed` marks a client that
disconnected before the response finished.

| `MCP_LOG_LEVEL` | Output |
| --- | --- |
| `off` | Startup line only |
| `info` (default) | One summary line per request, plus a reason and hint for a rejected one |
| `debug` | Also a `received` line with the headers the client sent |

No level prints the bearer token, a request body, or a response body. A call that
produces no log line at all never reached this process — check the client's host
permissions or firewall, the port, and that the URL ends in `/mcp`.

## Container

The image has no `.env`, and that is on purpose: a key baked into a layer stays
readable in `podman history` and `podman save` long after you think you rotated
it. All configuration arrives at run time, through the variables below.

### Published image

Every push publishes an image to GitHub Container Registry, so a machine that
only runs the server needs Podman and a pull token, not Node.js or a checkout.
Images are built for `linux/amd64` and `linux/arm64`.

| Tag | Moves | Use |
| --- | --- | --- |
| `sha-abcdef0` | never | The identity of one build; cite this when something breaks |
| `latest` | every push to `main` | A moving alias, convenient on a host you keep current |
| `1.2.3`, `1.2` | on a `v1.2.3` tag | A release you can pin |

The package starts private, so log in once. A token that can only read packages
is enough on a machine that just runs the server — never give it write access:

```bash
printf '%s' "$GHCR_TOKEN" | podman login ghcr.io -u <github-user> --password-stdin
podman pull ghcr.io/alexewerlof/deepseek-search-mcp:latest
```

For a run that must not change under you, use a digest instead of a tag, or pin
the `sha-` tag of the build you tested:

```bash
podman pull ghcr.io/alexewerlof/deepseek-search-mcp@sha256:<digest>
```

### Build locally

```bash
podman build -t deepseek-search-mcp .
```

### Run the container

`docker` works the same way as `podman`. The name at the end of the command is
the local build; if you pulled the published image instead, use
`ghcr.io/alexewerlof/deepseek-search-mcp:latest`.

The image binds `0.0.0.0` because a container's loopback is not reachable
through a published port, which is why `MCP_AUTH_TOKEN` is mandatory — the
server refuses to start without it rather than expose an open endpoint:

```bash
openssl rand -hex 32        # generate once; the same value goes in the client's config

podman run -d --name deepseek-search-mcp \
  -p 8765:8765 \
  -e DEEPSEEK_API_KEY=sk-... \
  -e MCP_AUTH_TOKEN=<paste-the-generated-token> \
  -e MCP_ALLOWED_ORIGINS=chrome-extension://* \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  deepseek-search-mcp
```

The token is a credential, not something to regenerate per start: the container
and the MCP host must agree on it.

`MCP_ALLOWED_ORIGINS` is only needed for browser clients. Add
`MCP_ALLOWED_HOSTS=198.51.100.10,localhost` to also reject requests whose `Host`
header is not one of those names; without it the server logs `host check off` at
startup and relies on the token. See [Host and Origin
checks](#host-and-origin-checks).

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

### Fedora (Quadlet)

Fedora generates the systemd unit from a Quadlet file instead of a compose file,
so the container starts at boot and restarts on failure. The unit ships in
[`deploy/deepseek-search-mcp.container`](deploy/deepseek-search-mcp.container),
with an environment template beside it.

The steps below are rootless: the service runs as your user, with no root and no
capabilities. Run them as that user from a checkout of this repository.

```bash
install -d -m 755 ~/.config/containers/systemd
install -m 644 deploy/deepseek-search-mcp.container ~/.config/containers/systemd/
install -d -m 700 ~/.config/deepseek-search-mcp
install -m 600 deploy/deepseek-search-mcp.env.example ~/.config/deepseek-search-mcp/env
$EDITOR ~/.config/deepseek-search-mcp/env

printf '%s' "$GHCR_TOKEN" | podman login ghcr.io -u <github-user> --password-stdin

systemctl --user daemon-reload
systemctl --user enable --now deepseek-search-mcp
systemctl --user enable --now podman-auto-update.timer
```

There is no `podman run` in this flow: `daemon-reload` reads the Quadlet file and
generates the unit. A missing `~/.config/deepseek-search-mcp/env` fails the
start, which is intended — the server refuses to bind off loopback without a
bearer token.

```bash
systemctl --user status deepseek-search-mcp
journalctl --user -u deepseek-search-mcp -n 20   # startup line and request logs
curl -i http://198.51.100.10:8765/mcp            # 401, not a timeout
```

`podman-auto-update.timer` polls daily; it is not triggered by a push. After
publishing a build, either wait or force it with `podman auto-update`. To freeze
the host at one build instead, replace `:latest` with the digest printed by
`podman inspect --format '{{index .RepoDigests 0}}' <image>` and drop
`AutoUpdate=registry` from the unit.

The unit publishes on the LAN. That port speaks plain HTTP, so the bearer token
crosses the network in the clear: put Caddy, nginx or a Tailscale/WireGuard
tunnel in front, or change the line to `PublishPort=127.0.0.1:8765:8765` and
proxy from the host.

For a system-wide service, move the files to `/etc/containers/systemd/` and
`/etc/deepseek-search-mcp/env`, use `systemctl` without `--user`, set
`EnvironmentFile=/etc/deepseek-search-mcp/env`, and change `[Install]` to
`WantedBy=multi-user.target`.

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
| `Binding to 0.0.0.0 exposes this server to the network` | Non-loopback bind without `MCP_AUTH_TOKEN`; the container sets `0.0.0.0` by default |
| Container exits immediately | Same as above: read `podman logs`, it prints the missing variable |
| `MCP_AUTH_TOKEN must be at least 32 characters` | Token too short; `openssl rand -hex 32` |
| `401` from curl, LM Studio or Jan | Token mismatch, or the client sends no `Authorization` header |
| `403` with `data.check=host` in the body | `MCP_ALLOWED_HOSTS` is set and does not contain the hostname the client used |
| `403` with `data.check=origin` in the body | The browser origin is not in `MCP_ALLOWED_ORIGINS`; `chrome-extension://*` covers every extension |
| Extension calls fail with `403` while curl succeeds | The extension's `Origin` (`chrome-extension://<id>`) is not covered by `MCP_ALLOWED_ORIGINS` |
| No log line for a client call | The request never arrived: check host permissions, firewall, port, and the `/mcp` path |
| Jan shows the server as connected but offers no tools | URL missing `/mcp`, or the selected model has no tool support |
| Tools listed but every call fails with 402 | DeepSeek balance is empty |
| `429` | Rate limit; wait, or reduce parallelism |
| Context overflow after one call | Lower `DEEPSEEK_SEARCH_MAX_RESULTS` or `DEEPSEEK_SEARCH_TEXT_CHARS` |
| `404` on fetch | The page blocks bots, is not HTML, or has no extractable content |

## Security

- Loopback bind by default; a public bind requires a bearer token.
- `Origin` validation is always installed, as the MCP specification requires.
  `Host` validation is an optional extra, enabled with `MCP_ALLOWED_HOSTS`.
- Tokens are compared in constant time.
- Plain HTTP exposes the bearer token to anyone on the path. Put Caddy or nginx in
  front for TLS, or use WireGuard, Tailscale or an SSH tunnel. A
  `Host` allowlist does not encrypt anything.
- The DeepSeek key is read once at startup and is never logged, echoed or passed
  to tool arguments.
