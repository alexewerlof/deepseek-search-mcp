# Security for local and remote MCP servers

The MCP specification makes authorization *optional* but constrains it: HTTP
transports SHOULD conform to the authorization spec, stdio servers SHOULD take
credentials from the environment, and servers MUST only accept tokens issued for
themselves. The practical rules below follow from those requirements.

## Threat: token passthrough

**Pattern.** The server accepts the client's credential and forwards it to an
upstream API.

**Why it is forbidden.** MCP servers MUST NOT accept or transit tokens that were
not issued for them. Forwarding breaks audience validation, destroys the audit
trail, and turns the server into a confused deputy that can be used for
exfiltration.

**Rule.** The upstream credential lives on the server (`DEEPSEEK_API_KEY` in the
environment or a `0600` file) and never travels through MCP. The client's token
authenticates the client to the *server* only.

## Threat: secrets in host configuration

Host config files — LM Studio's `mcp.json`, Cursor's `mcp.json`, Claude's
`claude_desktop_config.json` — are plaintext on disk. LM Studio stores tokens
securely only for OAuth-backed integrations, where it opens a browser and keeps
the result; a `headers` or `env` entry is just text.

**Consequences.**

- A billing key placed there leaks with the file: backups, dotfile syncs, screen
  shares, pasted logs.
- Revocation is all-or-nothing for that key.

**Mitigations, in order of preference.**

1. Keep the upstream key on the server; give the host a dedicated, revocable
   MCP token.
2. `chmod 600` the config file.
3. Prefer OAuth (see below) when the client supports it, so no secret sits in
   the file at all.

## Threat: unauthenticated network exposure

Binding to `0.0.0.0` publishes the server to every reachable host. The MCP SDK's
frameworks enable `Host`/`Origin` validation automatically for loopback binds and
**drop it** when you bind elsewhere, so the protection you had locally disappears
exactly when it matters most.

**Rules.**

- Refuse to start on a non-loopback address without a bearer token and an
  explicit `allowedHosts` list. Fail closed rather than warning.
- Require a long random token (32+ characters, `openssl rand -hex 32`).
- Plain HTTP exposes the bearer to anyone on the path. Terminate TLS at a reverse
  proxy (Caddy, nginx) or run over WireGuard/Tailscale/SSH.
- Prefer a dedicated port and firewall rule over exposing a general-purpose host.

## Threat: DNS rebinding

A malicious page resolves its own hostname to `127.0.0.1`, so the browser treats
a local server as same-origin and can call it.

**Mitigation.** Validate the `Host` header against an allowlist, and validate
`Origin` for browser origins. The SDK adapters do this for you on loopback binds;
when binding publicly you must supply the lists.

## Threat: privilege creep in tool design

Every tool the model can call is an action it can take on your behalf.

- Prefer read-only tools. Mark them `readOnlyHint: true` so hosts can auto-approve
  them safely.
- A tool that writes files, deletes data or spends money needs a narrow scope and
  an obvious name.
- Validate URLs server-side when a tool fetches them: reject non-HTTP schemes and
  embedded credentials. A server that will fetch `file://` is a local file reader.
- Never build a shell command from model-supplied text.

## Choosing an authentication tier

| Tier | Effort | Protects against | When to use |
| --- | --- | --- | --- |
| Loopback only, no auth | none | Other machines | Same machine, nothing else listening |
| Shared bearer token over TLS/tunnel | low | Everyone without the token | One user, a couple of machines |
| OAuth 2.1 resource server | high | Per-client consent, revocable scopes | Multiple users or third-party clients |

OAuth is the specification's full model: Protected Resource Metadata, resource
indicators, PKCE, audience validation. It is the right answer when different
clients must be distinguished or consent must be recorded. For a single-user
personal server on a home network, a bearer token over TLS is proportionate;
write the verifier behind an interface so upgrading is a local change.

## Logging

- Never log the API key, the bearer token, or a full `Authorization` header.
- Log the request path, status and duration to stderr.
- On stdio, stdout carries JSON-RPC: a single stray `console.log` corrupts the
  stream and the host reports a parse error.
