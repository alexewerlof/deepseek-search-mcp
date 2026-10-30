---
name: deepseek-search-fetch
description: Reference and integration guidance for the DeepSeek Search and Fetch APIs — exact request and response fields, supported query operators, the error table and which statuses are safe to retry, rate limits and per-request billing, and how to shape results for a model with a small context window. Use when calling https://api.deepseek.com/v1/tools/search or /v1/tools/fetch, wrapping them in an MCP tool, debugging 401/402/404/429 responses, or deciding how much page content to return.
---

# DeepSeek Search and Fetch

Two read-only endpoints on the same base URL, authenticated with the same bearer
key as the chat API. They are billed **per successful request**, not by token.

| Operation | Endpoint |
| --- | --- |
| Search | `POST https://api.deepseek.com/v1/tools/search` |
| Fetch | `POST https://api.deepseek.com/v1/tools/fetch` |

Headers: `Authorization: Bearer <key>` and `Content-Type: application/json`.

Full field tables: [references/api-contract.md](references/api-contract.md).

## Search in one screen

```json
{
    "query": "DeepSeek site:github.com lang:en after:2025",
    "count": 5,
    "need_content": false,
    "ori_question": "what did DeepSeek release in 2025"
}
```

- `query`: required, 1-128 characters, cannot be all whitespace.
- `count`: 1-50, default 10. Does not change the price.
- `ori_question`: optional, 1-128 characters; improves ranking when the query
  alone is ambiguous.
- `localization`: optional IP address used to localize results. A model cannot
  supply a meaningful value, so keep it server-side or omit it.
- `need_content`: default `false`; when false, `content` is always an empty
  string.

Supported operators: `site:`, `-site:`, `-term`, `-"exact phrase"`, `"exact
phrase"`, `lang:zh,en`, `after:2025`, `after:2025-01-01`, `before:2026`. Unknown
request fields are ignored.

Each result carries `title`, `url`, `snippet` (100-200 chars, for display),
`summary` (600-800 chars, for a model), `content` (page text), `site_name`,
`site_icon`, `date`, `rerank_score` (0-3, ≥1.5 is high quality), and `authority`
(0-4, ≥3 is highly authoritative; `-1` unknown).

**Pick one of `snippet` and `summary`** when you render results. They describe the
same page; sending both wastes context and adds no information.

## Fetch in one screen

```json
{ "url": "https://example.com/article" }
```

- `url`: required, ≤8192 characters, HTTP or HTTPS, must have a host, must not
  contain a username or password.
- Response: `title` (empty when unavailable) and `content` as Markdown.
- Fetching depends on the target site: bot blocking, non-HTML content and empty
  pages surface as `404`.

## Error handling that matches the docs

DeepSeek returns OpenAI-compatible errors: `{ error: { message, type, param,
code } }`, with `param` always `null`.

| Status | Meaning | Retry? |
| --- | --- | --- |
| 400 | Invalid headers or body | No — fix the request |
| 401 | Missing or invalid API key | No — fix the key |
| 402 | Insufficient balance | No — top up |
| 403 | Fetch rejected by the security policy | No — try another URL |
| 404 | Fetch found no usable content | No |
| 408 | Reading the request timed out | Yes |
| 413 | Request body too large | No |
| 429 | QPS limit exceeded | Yes, after a delay |
| 5xx | Internal or downstream failure | Yes |

Rate limits are per account and independent per endpoint: Search 100 QPS, Fetch
25 QPS, with an additional per-domain limit on Fetch. Billing is $0.75 per 1,000
successful requests for each endpoint; failed requests, empty search results and
timeouts are not billed.

Details and worked examples: [references/errors-limits-billing.md](references/errors-limits-billing.md).

## Wrapping them as MCP tools

- **One tool per endpoint.** `deepseek_search` and `deepseek_fetch`. Do not build
  a combined "research" tool: the model can chain two clear tools, and a
  combined tool hides which request it is about to pay for.
- **Default to a small result count** (5) and `need_content: false`. Local models
  overflow quickly; a caller that needs page text can ask for it.
- **Cap content.** Truncate `content` per result and cap the whole text block.
  Report truncation so the model can narrow the next call.
- **Never expose `localization`** as a tool argument.
- **Keep the key server-side.** The tool's caller authenticates to your server;
  the DeepSeek key never travels through MCP.
- **Map statuses to advice**, not just numbers: 402 means "top up", 429 means
  "wait", 404 for fetch means "this URL has no extractable content".
- **Treat an empty `results` array as success.** It is a normal, unbilled
  outcome.

Rendering guidance: [references/tool-output-formatting.md](references/tool-output-formatting.md).

## Sources

- <https://api-docs.deepseek.com/api/search>
- <https://api-docs.deepseek.com/api/fetch>
- <https://api-docs.deepseek.com/guides/search>
