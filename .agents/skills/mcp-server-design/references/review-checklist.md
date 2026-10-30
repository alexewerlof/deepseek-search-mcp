# MCP server review checklist

Run this before shipping a server or a new tool. Each item is cheap now and
expensive after a host has cached the tool list.

## Contract

- [ ] Tool names are namespaced and unique across likely-connected servers.
- [ ] Description states what it does, when to use it, and what it returns.
- [ ] Every argument has `.describe()` with units, ranges or format.
- [ ] Constraints are in the schema (`min`/`max`/`int`/`enum`/`url`), not only in
      prose.
- [ ] Defaults are declared in the schema for anything a model would have to
      guess.
- [ ] No argument exists that the model cannot reason about (IP addresses,
      internal flags, credentials).
- [ ] Annotations match behaviour; read-only tools say `readOnlyHint: true`.
- [ ] Tool count is small enough that the definitions do not dominate context.

## Output

- [ ] Human-readable text is the primary content block.
- [ ] `structuredContent` holds only compact, machine-useful fields and does not
      duplicate the prose.
- [ ] Long content is truncated with a visible marker and a `truncated` flag.
- [ ] Result counts and page sizes have defaults and caps.
- [ ] Empty results are reported as "no results", not as an error.
- [ ] Truncation cannot cut a multi-byte character (slice on code points or
      accept the risk knowingly).

## Failure handling

- [ ] Expected API failures return `isError: true` with an actionable sentence.
- [ ] No stack traces, file paths, tokens or request bodies in tool output.
- [ ] Retries are limited to timeouts, 429 and 5xx, with a bounded attempt count
      and backoff.
- [ ] Non-retryable 4xx answers immediately.
- [ ] Timeouts are enforced on every outbound request.

## Configuration and secrets

- [ ] Credentials come from the environment or a `0600` file, never from tool
      arguments.
- [ ] Startup fails with a message naming the missing variable.
- [ ] Config values are validated (ranges, integers) before the server binds.
- [ ] Nothing logs a credential, an `Authorization` header, or a full request
      body.
- [ ] The process never writes to stdout when it uses stdio transport.

## Transport and exposure

- [ ] Loopback bind for same-machine use.
- [ ] Non-loopback bind requires a bearer token and an explicit host allowlist.
- [ ] `Host` header validation is active (DNS rebinding).
- [ ] `Origin` validation is active when browser clients are possible.
- [ ] TLS or a private tunnel protects a network-exposed endpoint.
- [ ] Tokens are compared in constant time.

## Lifecycle

- [ ] Server instances are created per connection or per request, with no import
      time I/O.
- [ ] Shutdown closes in-flight work and the listener.
- [ ] `SIGINT` and `SIGTERM` exit with code 0 after a clean close.

## Tests

- [ ] Unit tests cover request mapping, retry policy and output caps with a
      stubbed transport.
- [ ] At least one test drives the real MCP surface (in-memory transport or a
      real HTTP request) and asserts on `structuredContent` and `isError`.
- [ ] Authentication is tested for missing, wrong and correct tokens.
- [ ] Any test that costs money or needs the network is separately runnable and
      skipped by default.
