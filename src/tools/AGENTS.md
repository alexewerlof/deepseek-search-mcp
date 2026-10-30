# src/tools/AGENTS.md

The two MCP tools. Each file owns one tool's name, schema, description, output
shape and error mapping.

## Registry

| Tool | File | Purpose |
| --- | --- | --- |
| `deepseek_search` | `search.ts` | Ranked web results for a query |
| `deepseek_fetch` | `fetch.ts` | One page as Markdown |

Names are namespaced because the model sees tools from every connected server at
once. Do not shorten them to `search` or `fetch`.

## Required shape of every tool

1. **Exported name constant** (`SEARCH_TOOL_NAME`) — tests and docs import it; no
   string literal duplicated elsewhere.
2. **`title`** for display, **`description`** that says what it does, when to use
   it, and what it returns.
3. **`inputSchema`** as `z.object(...)` with `.describe()` on every argument.
   Constraints live in the schema (`min`, `max`, `int`, `url`, `default`), not in
   prose, so the SDK rejects bad arguments before the handler runs.
4. **`outputSchema`** for `structuredContent`, kept small.
5. **`annotations`** that match reality: both current tools are read-only,
   idempotent, and `openWorldHint: true`.
6. **`isError: true`** for expected failures, with a message produced by
   `describeDeepSeekError`. Never throw for an API error, and never return an
   error string with `isError` unset.
7. **A `…ToolOptions` type** for server-side defaults, wired from `config.ts`.

## Output rules

- **Text first.** A model reads prose; JSON in a text block wastes tokens.
- **No duplication.** Long prose appears only in the text block.
  `structuredContent` carries identifiers and flags (title, url, counts,
  `truncated`), not the same sentences again.
- **One of summary or snippet.** They describe the same page at two lengths.
- **Respect the caps.** `contentChars`/`textChars`/`maxChars` come from config,
  and truncation must surface as a `truncated: true` flag.
- **Empty results are success.** `No results for "…"` with no `isError`.

## Argument rules

- Expose only arguments a model can reason about. `localization` (an IP address)
  is deliberately absent from the search tool.
- Prefer schema defaults over required arguments: `count` defaults to the
  configured value, `need_content` to `false`.
- Validate URLs before calling upstream (`fetch.ts` requires http/https, a host,
  and no credentials). The model gets a clear message instead of a 400.

## Adding a tool

1. Add `src/tools/<name>.ts` following the checklist above.
2. Register it in `src/server.ts`, add its options to `CreateServerOptions`, and
   thread them through `config.ts` if configurable.
3. Add a test in `test/unit/` covering the happy path, a schema rejection, and an
   `isError` mapping. Use the in-memory transport in `test/unit/tools.test.ts` as
   the template.
4. Update the tools table in `README.md` and this file's registry.

## Related

- [../AGENTS.md](../AGENTS.md)
- [../deepseek/AGENTS.md](../deepseek/AGENTS.md)
