---
name: mcp-server-design
description: Design rules for MCP servers that behave well in real hosts — choosing between tools, resources and prompts, writing tool contracts a model can actually use, shaping output to fit a small context window, mapping failures to isError, and choosing a transport with the right authentication. Use when building a new MCP server, adding or changing a tool, reviewing a server for security or usability, or wiring a server into LM Studio, Claude Desktop, VS Code or Cursor.
---

# Designing MCP servers

An MCP server is an API whose consumer is a language model. That single fact
drives most of the rules below: descriptions are prompts, schemas are the only
guardrail before execution, and every byte of output competes for context.

## 1. Pick the right primitive

| Primitive | Use it for | Model control |
| --- | --- | --- |
| Tool | An action or a lookup the model decides to invoke | Model chooses when and with what |
| Resource | Data the host may attach as context (files, records) | Host or user picks |
| Prompt | A reusable interaction template | User picks |

If the model must decide *when* to call it, it is a tool. If the host should be
able to attach it without the model asking, it is a resource. Do not expose an
operation as a tool merely because resources feel harder to wire: hosts differ in
what they surface, and a tool is the only primitive guaranteed to be callable.

Prefer a few well-named tools over many narrow ones. Two tools that always get
called together should usually be one tool.

## 2. Write the tool contract for a model, not a compiler

- **Name**: namespaced and explicit — `deepseek_search`, not `search`. The model
  sees tools from every connected server at once.
- **Description**: say what it does, when to use it, and what it returns. This is
  the only documentation the model gets. Include the disambiguating detail
  ("returns title, URL and a summary; set `need_content` for page text") and
  mention supported operators or limits.
- **Every argument needs `.describe()`**: units, ranges, formats, defaults, and
  an example where the format is not obvious.
- **Encode constraints in the schema**, not in prose: `min`, `max`, `int`,
  `enum`, `url`, `default`. The SDK validates before your handler runs, so a bad
  call becomes a clear message the model can retry from.
- **Defaults belong in the schema.** A default count or page size keeps the
  model from having to guess a sensible value.
- **Never expose a field the model cannot reason about** — a client IP for
  localization, an internal flag, a raw credential. Keep those server-side.

## 3. Shape output for a context window

- Return **text first**. Models read prose well; JSON blobs inside a text block
  are harder to use and cost the same tokens.
- Add `outputSchema` + `structuredContent` only for the parts a program can use
  (ids, URLs, counts, flags). Do **not** mirror long prose into structured
  content: that doubles the tokens for zero new information.
- **Cap output.** Truncate long page content, cap the number of results, and
  mark truncation (`… [truncated]` plus a `truncated: true` flag) so the model
  knows it may need a narrower follow-up call.
- Omit what the reader does not need. If a summary and a snippet describe the
  same page at different lengths, send one.
- Empty results are a normal outcome, not an error: say "no results" in a text
  block and keep `isError` unset.

## 4. Map failures to what the model should do next

- Invalid arguments: let schema validation answer (`isError: true`, message
  naming the field).
- Expected API failures: return `isError: true` with an actionable sentence —
  "The account has insufficient balance (HTTP 402). Top up before retrying." A
  bare status code is not actionable.
- Do not leak stack traces, file paths, or secrets into tool output. The model
  will repeat them to the user, and they may end up in logs.
- Retry only what is safe: timeouts, rate limits and 5xx. Retrying a 400 just
  burns another billable attempt.
- Prefer failing closed. A tool that silently returns an empty list on error
  teaches the model that the data does not exist.

## 5. Annotate honestly

Set annotations from behaviour, never aspirationally:

```ts
annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
```

Hosts use these to decide about auto-approval. Marking a mutating tool read-only
is a security bug, not a UX tweak.

## 6. Keep the server stateless and the factory cheap

Both transports build a fresh server instance per connection (stdio) or per
request (HTTP) from a factory. Register tools inside the factory; keep
connection pools, configuration and caches at module scope. Doing I/O at import
time makes the process unable to answer a health probe and leaks work into tests.

## 7. Choose the transport deliberately

| Situation | Transport | Notes |
| --- | --- | --- |
| Host spawns the server on the same machine | stdio | stdout is the wire: log to stderr only |
| Host is on another machine, or several hosts connect | Streamable HTTP | Needs Host/Origin validation and authentication |
| Web-standard runtime (Workers, Deno, Bun) | Streamable HTTP, `export default handler` | Same handler, no Node adapter |

For HTTP, treat the endpoint as a public API: validate `Host` (DNS rebinding),
validate `Origin` when browsers are involved, and require a bearer token whenever
the bind is not loopback. See [references/remote-http-hosting.md](references/remote-http-hosting.md).

## 8. Keep credentials server-side

The server authenticates to upstream APIs with its own credentials, loaded from
its own environment or a `0600` file. The host authenticates to the *server* with
a separate token.

Never accept an upstream credential from the client and forward it: MCP forbids
token passthrough, and a host config file is usually plaintext. See
[references/security.md](references/security.md) for the threat list.

## 9. Before you ship

Walk [references/review-checklist.md](references/review-checklist.md). It covers
the failures that are cheap to fix now and expensive later: unbounded output,
missing annotations, secrets in logs, unprotected binds, and non-idempotent
retries.

## Sources

- MCP introduction and architecture: <https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro>
- Security best practices: <https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices.md>
- Authorization specification: <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization.md>
- LM Studio as an MCP host: <https://lmstudio.ai/docs/app/mcp>
