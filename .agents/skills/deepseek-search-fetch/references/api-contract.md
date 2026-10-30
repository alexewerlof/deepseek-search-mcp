# API contract

Base URL: `https://api.deepseek.com`

Both endpoints are `POST`, accept `application/json`, and require
`Authorization: Bearer <DeepSeek API key>`.

## POST /v1/tools/search

### Request body

| Field | Type | Required | Default | Rules |
| --- | --- | --- | --- | --- |
| `query` | string | yes | — | 1-128 Unicode characters, not all whitespace |
| `count` | integer | no | 10 | 1-50 |
| `ori_question` | string or null | no | — | 1-128 characters; `null` treated as absent |
| `localization` | string | no | `""` | IP address used to localize results |
| `need_content` | boolean | no | `false` | When false, `content` is always `""` |

Unknown fields are ignored.

### Query operators

| Operator | Example | Effect |
| --- | --- | --- |
| `site:` | `DeepSeek site:github.com` | Restrict to a site; combine with `OR` for several |
| `-site:` | `DeepSeek -site:example.com` | Exclude a site |
| `-term` | `DeepSeek -advertisement` | Exclude pages containing the term |
| `-"..."` | `DeepSeek -"release notes"` | Exclude an exact phrase |
| `"..."` | `DeepSeek "exact phrase"` | Match an exact phrase |
| `lang:` | `DeepSeek lang:zh,en` | Restrict languages, comma separated |
| `after:` | `DeepSeek after:2025-01-01` | Published after a date |
| `before:` | `DeepSeek before:2026-06-01` | Published before a date |

### Response 200

```json
{
    "results": [
        {
            "rerank_score": 2.4,
            "title": "DeepSeek V4 model released",
            "url": "https://example.com/deepseek-v4",
            "snippet": "Short display summary, 100-200 characters.",
            "summary": "Longer summary, 600-800 characters, for a model to read.",
            "content": "Full page text, empty when need_content is false.",
            "site_name": "Example News",
            "site_icon": "https://example.com/favicon.ico",
            "date": "2026-06-01T00:00:00+00:00",
            "authority": 3
        }
    ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `rerank_score` | number | 0-3; ≥1.5 is high quality |
| `title` | string | Required |
| `url` | string | Required |
| `snippet` | string | 100-200 characters, meant for display |
| `summary` | string | 600-800 characters, meant for a model |
| `content` | string | Empty when `need_content` is false or unavailable |
| `site_name` | string or null | Required key, nullable value |
| `site_icon` | string or null | Required key, nullable value |
| `date` | string or null | RFC 3339 UTC, or null when unknown |
| `authority` | integer | 0-4; `-1` unknown; ≥3 highly authoritative |

No matches returns `200` with `"results": []`.

## POST /v1/tools/fetch

### Request body

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `url` | string | yes | ≤8192 characters; HTTP or HTTPS; must have a host; no username or password |

### Response 200

```json
{ "title": "Example article", "content": "# Example article\n\nArticle content." }
```

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Empty when unavailable |
| `content` | string | Page content as Markdown |

## Versioning note

The response bodies above are validated strictly by this repository
(`src/deepseek/schemas.ts`). Unknown extra fields are ignored by zod; missing
required fields become an `invalid_response` error rather than a
half-rendered tool result.
