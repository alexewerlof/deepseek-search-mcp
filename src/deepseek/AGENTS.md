# src/deepseek/AGENTS.md

The DeepSeek Search and Fetch client. Everything that knows about the upstream
API lives here; nothing else in the repo may hardcode a DeepSeek URL, field name
or status code.

## Files

| File | Responsibility |
| --- | --- |
| `constants.ts` | Paths, defaults, API limits, HTTP status codes, retry tuning |
| `schemas.ts` | zod schemas for request/response shapes, plus request types |
| `errors.ts` | `DeepSeekApiError`, retryable classification, model-facing messages |
| `client.ts` | `DeepSeekClient`: auth header, timeout, bounded retry, validation |
| `format.ts` | Turns validated responses into text for a model, with caps |

## Contract with the tools

Tools depend on the `DeepSeekSearchAndFetch` interface, not on the class:

```ts
search(request: SearchRequest): Promise<SearchResponse>
fetchPage(request: FetchRequest): Promise<FetchResponse>
```

Tests supply a plain object. Adding a method to the interface means updating both
the class and every stub in `test/unit/tools.test.ts`.

## Rules

1. **Validate every 200 response.** A `200` with an unexpected body is an
   `invalid_response` error, never content passed to the model. Unknown extra
   fields are fine; missing required fields are not.
2. **Retry only what the docs allow**: `408`, `429`, and `5xx`, plus transport
   failures. Never retry another `4xx` — it costs money and cannot succeed.
3. **Bound the retries.** `maxRetries` comes from config, default 2. Backoff is
   exponential with jitter so parallel calls do not synchronize.
4. **Always set a timeout** via `AbortSignal.timeout`. A tool call that hangs
   blocks the host's chat.
5. **Map failures to advice.** `describeDeepSeekError()` turns a status into a
   sentence a model can act on ("top up the account", "wait before retrying").
   Status codes alone are not actionable.
6. **Never log the key.** Log the path and status, never headers or bodies.
7. **No silent truncation.** `truncateText` appends a marker and reports the
   flag; callers must pass it through.

## Adding or changing an API call

1. Add or adjust the zod schema in `schemas.ts` and derive the type with
   `z.infer`.
2. Add the constant (path, default, limit) to `constants.ts`.
3. Add a method to `DeepSeekClient` that maps camelCase request fields to the
   wire's snake_case body and delegates to `postJson`.
4. Extend the `DeepSeekSearchAndFetch` interface.
5. Test with a stubbed `fetch`: assert the URL, headers and body, then the retry
   behaviour for a retryable and a non-retryable status.
6. Update `.agents/skills/deepseek-search-fetch/references/api-contract.md` if
   the upstream shape is now understood differently.

## Gotchas

- `site_name`, `site_icon` and `date` are *required keys with nullable values*,
  so the schema uses `.nullable()` rather than `.optional()`.
- `rerank_score` is 0-3 and `authority` is -1 to 4; do not clamp, they are
  meaningful.
- `need_content: false` means `content` is `""`, not absent.
- Search and Fetch have separate quotas; a fetch-heavy tool does not consume
  search budget.

## Related

- [../AGENTS.md](../AGENTS.md)
- [../tools/AGENTS.md](../tools/AGENTS.md)
