# Hosting an MCP server for LM Studio on another machine

LM Studio has been an MCP host since 0.3.17. It supports both local servers
(`command`, `args`, `env`) and remote servers (`url`, `headers`), configured in
`mcp.json` and editable in-app via **Program → Install → Edit mcp.json**. It
follows Cursor's notation.

## What LM Studio accepts

```json
{
  "mcpServers": {
    "deepseek-search": {
      "url": "http://198.51.100.10:8765/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

- `url` must point at the MCP endpoint itself, not the host root.
- `headers` are sent on every request, which is exactly what a bearer token
  needs.
- `env` exists for local (`command`) servers only. It cannot inject configuration
  into a server on another machine.
- Entries may include `auth: { CLIENT_ID, CLIENT_SECRET }` for OAuth-backed
  services. LM Studio then opens a browser, and "stores the token securely after
  you approve access". This is the only mechanism it offers that is not plain
  text, and it requires an authorization server you control.

The address above is from the RFC 5737 documentation range. Use the same
convention when writing examples: documentation addresses and `.example`
hostnames only, never a real machine.

## Implications for a two-machine setup

`mcp.json` on the LM Studio machine is plaintext. Therefore:

- Put a **dedicated MCP token** there, not the upstream provider key.
- Keep the upstream key on the server.
- `chmod 600` the file.
- Rotate the MCP token if the file is ever shared or synced.

## Protocol era

LM Studio is a 2025-era client: it opens with `initialize`. The TypeScript SDK v2
`createMcpHandler` (HTTP) and `serveStdio` (stdio) both serve 2025-era clients
from the same factory by default (`legacy: 'stateless'` / `'serve'`). Do not set
`legacy: 'reject'` unless you know every client speaks the 2026-07-28 envelope.

## Network checklist

1. Bind to the machine's LAN address (`0.0.0.0` or the specific IP) and set
   `MCP_ALLOWED_HOSTS` to the names or IPs clients use.
2. Open the port in the host firewall, scoped to the LAN subnet if possible.
3. Terminate TLS (Caddy or nginx) or use a tunnel; a bearer over plain HTTP is
   readable by anyone on the path.
4. Confirm reachability from the client machine before touching LM Studio:
   `curl -i http://HOST:PORT/mcp` should answer `401`, not time out.
5. Fully quit and relaunch LM Studio after editing `mcp.json`; reopening the
   window is not enough.
6. Read the server's stderr if the tools do not appear.

## Failure modes worth knowing

| Symptom | Likely cause |
| --- | --- |
| Tools missing from the list | Server not reachable, or `url` points at the root instead of `/mcp` |
| `401` in the LM Studio logs | Token mismatch, or a 2025-era client sending no `Authorization` |
| `403` | `Host`/`Origin` allowlist missing or wrong |
| Calls succeed from curl but not from LM Studio | Client sends no `Origin` header, or the endpoint expects a path prefix |
| Context overflows after one call | Tool output is too large; lower result counts and page caps |

## Sources

- <https://lmstudio.ai/docs/app/mcp>
- <https://lmstudio.ai/docs/app/mcp/deeplink>
- <https://lmstudio.ai/docs/developer/core/mcp>
