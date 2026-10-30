# Rendering search and fetch results for a model

The reader is a language model with a finite context window, often a small local
one. Two rules follow: give it the most useful text once, and never surprise it
with unbounded length.

## Search: a compact, scannable block

```
Query: deepseek v4 release
Results: 2

1. DeepSeek V4 released
   URL: https://example.com/deepseek-v4
   site: Example News | published: 2026-06-01T00:00:00+00:00 | authority: 3 | relevance: 2.40
   DeepSeek has released V4, adding improved tool calling and long-context support.

2. ...
```

Why this shape:

- Position and title first, so the model can refer to "result 2" later.
- URL on its own line, because the model will often quote it.
- One metadata line, pipe-separated: compact and still parseable by eye.
- Body text once. Use `summary` when present, otherwise `snippet`. Sending both
  duplicates the same claim at two lengths.
- `content` only when the caller asked for it, prefixed with `Content:` so it is
  distinguishable from the summary.

## Fetch: header plus body

```
URL: https://example.com/article
Title: Example article
Content length: 8123 characters

# Example article

Article content as Markdown...
```

`Content length` is the *original* length, so the model can tell that a short
body was truncated rather than short at the source.

## Truncation

- Cap per-field content (for example 2,000 characters per search result).
- Cap the whole text block (for example 12,000 characters).
- Append an explicit marker (`… [truncated]`) and expose a boolean
  `truncated` in structured output.
- Prefer cutting at a paragraph or sentence boundary when the content is prose.
  A cut mid-word is still better than no cap at all.
- Never let one result consume the whole budget: cap per result first, then the
  total.

## Structured content: metadata only

Text already carries the prose. Structured output should add what a program
needs and a model cannot easily recover from prose:

```json
{
    "query": "deepseek v4 release",
    "returned": 2,
    "truncated": false,
    "results": [
        {
            "title": "DeepSeek V4 released",
            "url": "https://example.com/deepseek-v4",
            "site_name": "Example News",
            "date": "2026-06-01T00:00:00+00:00",
            "rerank_score": 2.4,
            "authority": 3
        }
    ]
}
```

Do not copy the summary or page content into both blocks: that doubles token
usage for no new information.

## Empty and partial results

- No matches: `No results for "<query>".` with `isError` unset. It is a valid
  answer, and the docs confirm empty searches are not billed.
- Some results lack `site_name`, `date` or `content`: omit those parts of the
  line instead of printing `null`.
- All results truncated: say so in the text, not only in the JSON.

## Anti-patterns

| Anti-pattern | Consequence |
| --- | --- |
| Returning raw API JSON as one text block | Model spends tokens on brackets and repeated keys |
| Including both snippet and summary | Duplicated claims, ~2x tokens |
| Returning 20 full pages by default | Context overflow on a local model |
| Silent truncation | Model assumes it saw everything and answers confidently wrong |
| Returning an error string with `isError` unset | Host reports success; the model may present the error as data |
