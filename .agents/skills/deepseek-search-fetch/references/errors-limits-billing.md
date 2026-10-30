# Errors, limits and billing

## Error body shape

OpenAI-compatible; `param` is always `null`.

```json
{
    "error": {
        "message": "'count' must be between 1 and 50",
        "type": "invalid_request_error",
        "param": null,
        "code": "invalid_request_error"
    }
}
```

Treat `code` as an opaque string. Branch on the HTTP status.

## Status table

| Status | Meaning | Retry | What to tell the user or model |
| --- | --- | --- | --- |
| 400 | Invalid headers or body, malformed JSON, bad field value | No | The request is wrong; fix the arguments |
| 401 | API key missing or invalid | No | Check the key on the server |
| 402 | Insufficient balance | No | Top up the account |
| 403 | Fetch rejected by the security policy | No | The target is blocked; try another URL |
| 404 | Fetch found no usable content (unavailable, blocked, wrong content type, empty) | No | This URL cannot be fetched |
| 408 | Reading the request body timed out | Yes | Retry |
| 413 | Request body too large | No | Shorten the request |
| 429 | QPS limit exceeded | Yes, after a delay | Wait and retry |
| 500 | Internal server error | Yes | Retry |
| 504 | Downstream request timed out | Yes | Retry |

DeepSeek's own guidance: for 408, 429 and 5xx, wait and retry; for 402, top up;
do not retry other 4xx without changing the request.

## Retry policy that respects the docs

```
retryable = status in {408, 429} or status >= 500
maxRetries = 2 (configurable)
delay = 500ms * 2^(attempt-1) + up to 250ms jitter
```

Transport failures (DNS, TLS, connection reset, abort) are worth retrying; a
client-side timeout is worth one retry at most, then report it.

Every retry may be billed if it eventually succeeds, so cap attempts low.

## Rate limits

Per account, independent per endpoint:

| Endpoint | QPS |
| --- | --- |
| Search | 100 |
| Fetch | 25 |

- Limits apply at the account level regardless of which key is used.
- Fetch also has a per-domain QPS limit; exceeding it also returns 429.
- Search and Fetch quotas are separate: heavy searching does not consume fetch
  quota.

## Billing

| Operation | Price |
| --- | --- |
| Search | $0.75 per 1,000 successful requests |
| Fetch | $0.75 per 1,000 successful requests |

- Charged per request, not per token or per returned result.
- `count` does not change the price.
- Billable only when the response is `200` **and** produces a result: Search must
  return a non-empty `results` array, Fetch must return page content.
- Failed requests, empty search results and timeouts are not billed.

## Cost-saving choices in this repository

- Default `count` is 5 rather than the API's 10.
- `need_content` defaults to false.
- Retries are capped at 2 and only for retryable statuses.
- A 401 from a bad key is never retried, which keeps a misconfiguration from
  producing a burst of failed calls.
