# Shared behavior

The [Weather API](weather.md) and the [Research API](research.md) are served by the same service. They share a base URL, an API key and a rate limit. This page describes the behavior that is the same on both endpoints. Every example is a real request and response, and all requests send a valid `X-API-Key`. Latencies are full round-trip times measured by the client.

| | |
|---|---|
| Base URL | `https://elyos-interview-907656039105.europe-west2.run.app` |
| Endpoints | [`GET /weather`](weather.md), [`GET /research`](research.md) |
| Authentication | `X-API-Key: <key>` header, the same key for both endpoints |

## Rate limiting

Neither endpoint documents a rate limit, but both have one, and they share it. When it is hit, the API does not return `429 Too Many Requests`. It returns `200 OK` with a body in a completely different format, the same on both endpoints:

```http
GET /weather?location=London
```

**Response:** `200 OK`, 167 ms

```json
{
    "status": "throttled",
    "message": "Rate limit exceeded. Please wait.",
    "retry_after_seconds": 28,
    "data": null
}
```

```http
GET /research?topic=solar+energy
```

**Response:** `200 OK`, 165 ms

```json
{
    "status": "throttled",
    "message": "Rate limit exceeded. Please wait.",
    "retry_after_seconds": 22,
    "data": null
}
```

- **Checking only the status code is not enough.** A client that does so will treat this as a normal result, even though none of the endpoint's usual fields are present. The only sign is `"status": "throttled"`.
- **The wait time is only in the body.** There is no `Retry-After` header and no `X-RateLimit-*` headers.
- **The limit is about 5 requests per 30 seconds.** Five requests in a row succeeded, and the sixth was throttled with `retry_after_seconds: 28`.
- **Both endpoints count toward the same limit.** The `/research` request above was the first one made; only `/weather` requests had been made before it.
- **`retry_after_seconds` counts down in real time.** It went 28, 27, … 21 over the next ~6.5 s of continued requests. Requests rejected while throttled do not seem to restart or extend the wait.
- **Waiting `retry_after_seconds` does not guarantee the next request succeeds.** With two clients sharing the key, four requests sent 6.5 s apart were each rejected with the same response:

  ```json
  {"status":"throttled","message":"Rate limit exceeded. Please wait.","retry_after_seconds":1,"data":null}
  ```

- **Spacing requests evenly does not reliably avoid the limit.** Requests sent every 6.5 s put at most 5 in any 30 s window. The 6th one (at 32.5 s) was still throttled with `retry_after_seconds: 1`, because the first request had taken 5.1 s to complete (see [weather.md §4](weather.md#4-the-first-request-after-a-quiet-period-is-slow)).
