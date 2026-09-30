# Weather API

`GET /weather` returns the current weather for a named place. The response gives the temperature in °C, a short description of the conditions and the relative humidity. It is the fast tool of the two: the documentation says about 200 ms, and normal responses take about 250–400 ms.

| | |
|---|---|
| Base URL | `https://elyos-interview-907656039105.europe-west2.run.app` |
| Endpoint | `GET /weather` |
| Parameter | `location` (string, required): a place name, e.g. `London` or `Tokyo`, or a US ZIP code, e.g. `12345` |
| Authentication | `X-API-Key: <key>` header |
| Official documentation | "Weather data for the location". Nothing else is documented. |

This page describes how the endpoint actually behaves. Every example is a real request and response. All requests send a valid `X-API-Key` unless stated otherwise. Latencies are full round-trip times measured by the client. Rate limiting works the same way on both endpoints and is described in [shared.md](shared.md#rate-limiting).

## Expected behavior

```http
GET /weather?location=London
X-API-Key: <key>
```

**Response:** `200 OK`, 294 ms

```json
{"location":"London","temperature_c":19.9,"condition":"Overcast","humidity":74}
```

| Field | Type | Meaning |
|---|---|---|
| `location` | string | The place the query was matched to. This is not always what was asked for; see [§2](#2-england-or-scotland-after-the-city-returns-a-different-place) and [§3](#3-são-paulo-comes-back-as-san-paulo). |
| `temperature_c` | number | Temperature in °C, to one decimal place |
| `condition` | string | Free text, e.g. `Overcast`, `Partly Cloudy`, `Light drizzle`, `Patchy rain nearby`, `Smoky haze`, `Mist`. It is not a fixed set of values. |
| `humidity` | number | Relative humidity, % |

Matching ignores letter case and surrounding spaces: `london`, `LONDON` and `␣London␣` all return `"location":"London"` with the same data.

**US ZIP codes work too.**

```http
GET /weather?location=12345
```

**Response:** `200 OK`

```json
{"location":"Schenectady","temperature_c":12.7,"condition":"Overcast","humidity":88}
```

**Ambiguous names return one place, without saying which.** A name shared by several places, such as `Springfield`, returns a single result: `{"location":"Springfield","temperature_c":14.3,"condition":"Cloudy","humidity":85}`. Adding a state or country selects a specific place, but the returned `location` leaves it out, so the response alone can't confirm which place was used:

| Request | Response |
|---|---|
| `GET /weather?location=Paris` | `{"location":"Paris","temperature_c":20.4,"condition":"Overcast","humidity":71}` |
| `GET /weather?location=Paris%2C+France` | `{"location":"Paris","temperature_c":20.4,"condition":"Overcast","humidity":71}` |
| `GET /weather?location=Paris%2C+TX` | `{"location":"Paris","temperature_c":28.9,"condition":"Overcast","humidity":46}` |

Callers should include the state or country whenever a place name is ambiguous, using the country name or code (e.g. `UK`), not `England` or `Scotland` (see [§2](#2-england-or-scotland-after-the-city-returns-a-different-place)).

## Error cases

| Status | When | Example request | Body |
|---|---|---|---|
| `401` | `X-API-Key` missing, empty or wrong | `GET /weather?location=London` | `{"error":"Invalid or missing API key"}` |
| `404` | No place matches the location | `GET /weather?location=asdfgh` | `{"error":"Location \"asdfgh\" not found"}` |
| `405` | Any method other than GET | `POST /weather?location=London` | `{"detail":"Method Not Allowed"}` |
| `422` | `location` parameter missing | `GET /weather` | `{"detail":[{"type":"missing","loc":["query","location"],"msg":"Field required","input":null}]}` |

The error text is in a different field depending on the error: `error` for 401 and 404, and `detail` for 405 and 422. `detail` is a string for 405 but an array of objects for 422. Rate-limited responses use a third field, `message` (see [shared.md](shared.md#rate-limiting)).

## Unexpected behavior

| # | Behavior | Status | How to recognize it | When it happens |
|---|---|---|---|---|
| 1 | A second response format with two conflicting readings | `200` | `conditions` array instead of `temperature_c` / `condition` / `humidity` | ~1 in 4–5 responses, unpredictably |
| 2 | `England` or `Scotland` after the city returns a different place | `200` | `location` names the region (e.g. `England`) instead of the city | Every time the qualifier is `England` or `Scotland` |
| 3 | `São Paulo` comes back as `San Paulo` | `200` | `San Paulo` in `location` | Most requests for `São Paulo` written with the accent |
| 4 | Slow first request after the service has been idle | `200` | Takes 4–7 s instead of ~300 ms | First request after a quiet period (13 min was fine; under 45 min was not) |
| 5 | Empty values and some real places return 404 | `404` | `error` field | Depends on the input |

### 1. The response format sometimes changes

About 1 in 4–5 successful responses, for any location, use a different format. It happens unpredictably, so the same request can return either format. The top-level fields are replaced by a `conditions` array with two readings, and a `note` is added:

```http
GET /weather?location=London
```

**Response:** `200 OK`, 315 ms

```json
{
  "location": "London",
  "conditions": [
    {"temperature_c": 19.3, "condition": "Overcast", "humidity": 83},
    {"temperature_c": 18.3, "condition": "light rain", "humidity": 96}
  ],
  "note": "Multiple conditions reported"
}
```

The same request at the same time more often returned the normal format:

```json
{"location":"London","temperature_c":19.3,"condition":"Overcast","humidity":83}
```

- **The top-level weather fields are missing.** `temperature_c`, `condition` and `humidity` do not appear at the top level, so code reading `body.temperature_c` gets `undefined`.
- **The two readings contradict each other**, and nothing in the response says which one is right.
- **The first reading matches the normal response.** In every case it has been identical to the normal response for that location.
- **The second reading follows a fixed pattern.** It is always exactly 1.0 °C colder, its condition is always `"light rain"` in lowercase (every other condition is capitalized), and its humidity is higher. Every response in this format has had exactly two readings.

### 2. `England` or `Scotland` after the city returns a different place

Qualifying a city with `England` or `Scotland` returns the weather for a different place. The city is ignored, and `location` names the region, or a place named after it:

```http
GET /weather?location=London%2C+England            # London, England
```

**Response:** `200 OK`

```json
{"location":"England","temperature_c":6.1,"condition":"Cloudy","humidity":88}
```

46 seconds later, `London, GB` returned `{"location":"London","temperature_c":19.3,"condition":"Overcast","humidity":86}`.

| Request | Response |
|---|---|
| `London, England`, `Birmingham, England`, `Leeds, England` | `{"location":"England","temperature_c":6.1,"condition":"Cloudy","humidity":88}` |
| `Manchester, England` | `{"location":"Old England","temperature_c":23.7,"condition":"Mist","humidity":95}` |
| `Glasgow, Scotland`, `Edinburgh, Scotland` | `{"location":"Scotland","temperature_c":28.1,"condition":"Light rain shower","humidity":78}` |

- **It happens every time.** Each of these inputs returned the same wrong place on every request.
- **Only `England` and `Scotland` cause it.** `Wales`, `UK`, `GB`, `United Kingdom`, other countries and US states all returned the right city, e.g. `Manchester, UK` → `{"location":"Manchester","temperature_c":18.1,"condition":"Light drizzle","humidity":84}`.
- **`England` on its own is fine.** It returns London: `{"location":"London","temperature_c":19.3,"condition":"Overcast","humidity":86}`.
- **A `200` doesn't mean the location was understood.** Nothing in the response flags the mismatch; `location` is the only clue.
- **Other text can do the same.** `London; DROP TABLE` returns a place called "Tiar Drop", every time: `{"location":"Tiar Drop","temperature_c":26.6,"condition":"Partly Cloudy","humidity":80}`. Nonsense such as `asdfgh` and typos such as `Londn` return `404` instead (see [Error cases](#error-cases)).

### 3. `São Paulo` comes back as `San Paulo`

Requests for `São Paulo`, written with the accent, usually return the right weather under a misspelled name:

```http
GET /weather?location=S%C3%A3o+Paulo                # São Paulo
```

**Response:** `200 OK`

```json
{"location":"San Paulo","temperature_c":25.0,"condition":"Overcast","humidity":68}
```

- **The weather is right; only the name is wrong.** The same city without the accent, requested 6.5 s earlier, returned identical readings under the correct name: `{"location":"Sao Paulo","temperature_c":25.0,"condition":"Overcast","humidity":68}`.
- **It is specific to this city.** Other accented names come back correctly, including other `São` cities: `São Luís`, `São Tomé`, `Guimarães`, `Zürich`, `Bogotá`, `Montréal`, `Kraków` and `Reykjavík`.
- **It happens most of the time, not always.** One request returned `Sao Paulo` instead, and adding the country (`São Paulo, Brazil`) still returned `San Paulo`.
- **`San Paulo` is not a translation of the name.** In Spanish or Italian, the second word would change too (`San Pablo`, `San Paolo`).

### 4. The first request after a quiet period is slow

The first request after a quiet period took 4–7 s instead of about 300 ms. A 13-minute gap between requests did not cause it, but a gap of under 45 minutes did. The response itself was normal:

| Request | Latency | Response |
|---|---|---|
| `GET /weather?location=London`, the first request after being idle | 5,134 ms | `{"location":"London","temperature_c":19.9,"condition":"Overcast","humidity":74}` |
| The same request, 6.5 s later | 251 ms | `{"location":"London","temperature_c":19.9,"condition":"Overcast","humidity":74}` |

Two other first requests took 6,795 ms and 4,028 ms. The 4,028 ms one was a `404` that took 362 ms when repeated six minutes later, so the delay came from the quiet period, not from the lookup. This looks like a server cold start. A timeout set for the documented ~200 ms would fail these requests. The delay can also affect how requests are counted against the rate limit (see [shared.md](shared.md#rate-limiting)).

### 5. Empty values and some real places return 404

An empty `location` is not treated as missing, which would give `422` (see [Error cases](#error-cases)). It is looked up like a place name and returns `404`:

```http
GET /weather?location=
```

**Response:** `404 Not Found`

```json
{"error":"Location \"\" not found"}
```

| Request | Response |
|---|---|
| `GET /weather?location=+++` (three spaces) | `404` `{"error":"Location \"   \" not found"}` |
| `GET /weather?location=Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch` (a real village in Wales, 58 characters) | `404` `{"error":"Location \"Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch\" not found"}` |

**A real place can be rejected.** The Welsh village returns `404` every time. From the outside, it isn't possible to tell whether the service doesn't know the place or cuts long input, as [`/research` does at 50 characters](research.md#3-topics-longer-than-50-characters-are-silently-shortened). Long input isn't rejected outright: the 63-character address `10 Downing Street, Westminster, London SW1A 2AA, United Kingdom` returns `{"location":"Westminster","temperature_c":20.5,"condition":"Patchy rain nearby","humidity":69}`.
