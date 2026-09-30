# Research API

`GET /research` returns a short research summary for a topic, with a list of sources. It is the slow tool of the two: the documentation says each request takes 3–8 seconds. That makes it the case where a client needs to show that work is in progress and let the user cancel.

|                        |                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------- |
| Base URL               | `https://elyos-interview-907656039105.europe-west2.run.app`                      |
| Endpoint               | `GET /research`                                                                  |
| Parameter              | `topic` (string, required), e.g. `solar energy`                                  |
| Authentication         | `X-API-Key: <key>` header                                                        |
| Official documentation | "Research summary on the topic", taking 3–8 seconds. Nothing else is documented. |

This page describes how the endpoint actually behaves. Every example is a real request and response. All requests send a valid `X-API-Key` unless stated otherwise. Latencies are full round-trip times measured by the client. Rate limiting works the same way on both endpoints and is described in [shared.md](shared.md#rate-limiting).

## Expected behavior

```http
GET /research?topic=solar+energy
X-API-Key: <key>
```

**Response:** `200 OK`, 4,787 ms

```json
{
    "topic": "solar energy",
    "summary": "Research summary for 'solar energy'. This analysis covers key aspects and recent developments in the field.",
    "sources": ["nature.com", "sciencedirect.com", "arxiv.org"],
    "generated_at": "2026-09-30T04:06:07.743259+00:00"
}
```

| Field          | Type     | Meaning                                                           |
| -------------- | -------- | ----------------------------------------------------------------- |
| `topic`        | string   | The topic as it was sent                                          |
| `summary`      | string   | The research summary                                              |
| `sources`      | string[] | Domain names of the sources                                       |
| `generated_at` | string   | An ISO 8601 UTC timestamp with microseconds and a `+00:00` offset |

Responses with a summary took 3.4–8.1 s end to end: the documented 3–8 s plus about 0.2 s of network time. The first request after a quiet period can take several seconds longer; this was seen on `/weather` ([weather.md §4](weather.md#4-the-first-request-after-a-quiet-period-is-slow)).

## Error cases

| Status | When                       | Example request                     | Body                                                                                          |
| ------ | -------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `401`  | `X-API-Key` header missing | `GET /research?topic=solar+energy`  | `{"error":"Invalid or missing API key"}`                                                      |
| `405`  | Any method other than GET  | `POST /research?topic=solar+energy` | `{"detail":"Method Not Allowed"}`                                                             |
| `422`  | `topic` parameter missing  | `GET /research`                     | `{"detail":[{"type":"missing","loc":["query","topic"],"msg":"Field required","input":null}]}` |

The error text is in a different field depending on the error: `error` for 401, and `detail` for 405 and 422. `detail` is a string for 405 but an array of objects for 422. Rate-limited responses use a third field, `message` (see [shared.md](shared.md#rate-limiting)).

## Unexpected behavior

| #   | Behavior                                         | Status | How to recognize it                                                   | When it happens                                                          |
| --- | ------------------------------------------------ | ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Some responses are marked as old cached results  | `200`  | `"cached": true`, a fixed 2024 `generated_at`, different summary text | ~1 in 6 responses, unpredictably; repeating a request doesn't trigger it |
| 2   | An empty `{}` body after a long wait             | `200`  | No `topic` or `summary` field                                         | Rare (about 1 in 30)                                                     |
| 3   | Topics over 50 characters are silently shortened | `200`  | `"truncated": true`                                                   | Every topic over 50 characters                                           |

### 1. Some responses are marked as old cached results

About 1 in 6 responses comes back marked as an old cached result instead of a fresh one. It happens unpredictably, for any topic:

```http
GET /research?topic=solar+energy
```

**Response:** `200 OK`, 6,931 ms

```json
{
    "topic": "solar energy",
    "summary": "Research on 'solar energy' from early 2024. This cached summary may not reflect recent developments.",
    "sources": ["nature.com", "sciencedirect.com", "arxiv.org"],
    "generated_at": "2024-03-15T09:00:00Z",
    "cached": true,
    "cache_age_seconds": 26784000
}
```

**How to recognize it.** Three things always differ from a fresh response:

|                | Fresh response                                                                                           | "Cached" response                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `summary`      | `Research summary for '<topic>'. This analysis covers key aspects and recent developments in the field.` | `Research on '<topic>' from early 2024. This cached summary may not reflect recent developments.` |
| `generated_at` | The current time, with microseconds and a `+00:00` offset, e.g. `2026-09-30T04:06:07.743259+00:00`       | Always `2024-03-15T09:00:00Z`, with no fractions of a second                                      |
| Extra fields   | None                                                                                                     | `"cached": true` and `"cache_age_seconds": 26784000`, always with these values                    |

Speed can't be used to tell them apart. "Cached" responses took 3.9–8.1 s, the same range as fresh ones.

**It is not a copy of an earlier response.**

- **It never matches an earlier fresh response.** The request above was sent 3 seconds after a fresh `solar energy` response, generated at `2026-09-30T01:24:11.864553+00:00`, had arrived. A real cache would have returned that response.
- **It is the same fixed text every time**, with only the topic filled in. An empty topic came back "cached" the first time it was answered, when there was nothing earlier to cache.
- **Its only exact matches are other "cached" responses for the same topic**, which are always identical to each other.

**When it happens.**

- **Repeating a request doesn't trigger it.** Most identical requests come back fresh, including ones sent seconds apart.
- **A topic requested for the first time can also come back "cached".**
- **The time since the previous request for the same topic makes no difference.** "Cached" responses have come a few seconds, 16 minutes and 2.4 hours after the previous request, and fresh ones have come after the same gaps.
- **It happens for any input**, including an empty topic and `Solar Energy` in title case.
- **It can combine with truncation.** A topic over 50 characters can come back both shortened and "cached", with both sets of extra fields (see [§3](#3-topics-longer-than-50-characters-are-silently-shortened)).

**Other details.**

- **The two age values contradict each other.** `cache_age_seconds` is 26,784,000 s, which is 310 days, but `generated_at` (15 March 2024) was about 2.5 years before the response was returned.
- **The summary itself warns** that it "may not reflect recent developments".

### 2. Sometimes an empty object is returned after a long wait

```http
GET /research?topic=solar+energy
```

**Response:** `200 OK`, **15,210 ms**, with `content-type: application/json` and `content-length: 2`:

```json
{}
```

- **Everything except the body looks like success:** the status code, the content type, and the fact that the body is valid JSON. The body has none of the expected fields.
- **The response took almost twice the documented maximum of 8 seconds.**
- **It is intermittent.** The same request made just before and just after this one returned normal summaries.

### 3. Topics longer than 50 characters are silently shortened

A 51-character topic still returns `200 OK`, but the research covers only its first 50 characters. Here, the last letter of "Chile" is lost:

```http
GET /research?topic=the+environmental+impact+of+lithium+mining+in+Chile     # 51 characters
```

**Response:** `200 OK`, 4,274 ms

```json
{
    "topic": "the environmental impact of lithium mining in Chile",
    "summary": "Research summary for 'the environmental impact of lithium mining in Chil'. This analysis covers key aspects and recent developments in the field.",
    "sources": ["nature.com", "sciencedirect.com", "arxiv.org"],
    "generated_at": "2026-09-30T04:55:51.967880+00:00",
    "truncated": true,
    "original_topic_length": 51,
    "processed_topic": "the environmental impact of lithium mining in Chil"
}
```

- **`topic` still shows the full input**, so it hides the fact that anything was cut. The summary is about `processed_topic`, which is the first 50 characters.
- **Three extra fields are the only sign of it:** `truncated`, `original_topic_length` and `processed_topic`.
- **The limit is exactly 50.** The 50-character topic `the environmental impact of lithium mining in Peru` comes back unchanged, with none of these fields.
- **The cut ignores word boundaries.** A 121-character question is cut mid-word (example below), and a 500-character topic is cut the same way.

**It can combine with a "cached" response** ([§1](#1-some-responses-are-marked-as-old-cached-results)). Both sets of extra fields then appear together, and the "cached" sentence uses the shortened topic:

```http
GET /research?topic=the+long-term+economic+and+environmental+effects+of+offshore+wind+farms+on+coastal+fishing+communities+in+northern+Europe
```

**Response:** `200 OK`, 6,512 ms

```json
{
    "topic": "the long-term economic and environmental effects of offshore wind farms on coastal fishing communities in northern Europe",
    "summary": "Research on 'the long-term economic and environmental effects o' from early 2024. This cached summary may not reflect recent developments.",
    "sources": ["nature.com", "sciencedirect.com", "arxiv.org"],
    "generated_at": "2024-03-15T09:00:00Z",
    "cached": true,
    "cache_age_seconds": 26784000,
    "truncated": true,
    "original_topic_length": 121,
    "processed_topic": "the long-term economic and environmental effects o"
}
```
