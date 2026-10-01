# Elyos chat CLI

A terminal chat app that streams replies from OpenAI (`gpt-6-astra`, Responses API) and can call two tools, `get_weather` and `research_topic`, backed by the Elyos interview API.

## Running it

Requires Node.js 22 or later.

```bash
npm install
cp .env.example .env
npm start
```

Fill in `ELYOS_API_KEY`, `ELYOS_BASE_URL` and `OPENAI_API_KEY` in `.env` before starting.

Ctrl+C cancels the current reply or tool call. Type `quit`, `exit` or `q` to leave.

## How it works

- `src/index.ts` runs the prompt loop and the LLM loop: stream a response, run any tool calls, send their results back, and repeat until the model answers without calling a tool. The conversation history is kept in memory and sent with every request.
- `src/api.ts` is the Elyos API client. It turns each quirk below into either a normal result or an `ElyosApiError` that says whether a retry could help, and `withRetry` acts on that (up to 5 attempts).

Tool errors go back to the model as `{error}`, so it can fix its call or tell the user, instead of ending the turn.

**Cancellation.** Each turn gets one `AbortController`, and Ctrl+C aborts it. The same signal goes to the OpenAI stream, every `fetch`, and the wait before a retry, so nothing keeps running after a cancel. Text already streamed stays on screen. A cancelled tool call is recorded with a `Cancelled by the user` result, so the history stays valid for the next turn.

## API quirks and how they're handled

The full notes, with real requests and responses, are in [doc/apis](doc/apis/).

| Quirk                                                                                                                 | Handling                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limiting (~5 requests per 30 s, shared by both endpoints) returns `200` with `{"status":"throttled"}`, not `429` | Detected from the body. If `retry_after_seconds` is 10 s or less, wait and retry. Otherwise the model gets an error and is told to tell the user.                |
| `/weather` sometimes replaces its fields with a `conditions` array of two contradictory readings                      | Use the first reading. In every case observed, it matched the normal response.                                                                                   |
| `/weather` can match a different place than the one asked for (e.g. `London, England` returns `England`)              | The tool description tells the model to check the returned `location`, qualify cities with a country name or code, and state its assumption for ambiguous names. |
| `/weather` takes 4–7 s on the first request after a quiet period                                                      | 8 s timeout, instead of one close to the documented ~200 ms.                                                                                                     |
| `/research` sometimes returns a stale 2024 result marked `cached: true`                                               | Retry. A repeat request is usually fresh.                                                                                                                        |
| `/research` sometimes returns an empty `{}` after ~15 s                                                               | A 9 s timeout cuts off the wait, and any response without a `summary` is retried.                                                                                |
| `/research` silently cuts topics to 50 characters                                                                     | Longer topics are rejected before sending, with an error telling the model to shorten them.                                                                      |
| Error bodies put the message in different fields (`error`, `detail`)                                                  | Use `error` when present, otherwise the HTTP status. Non-2xx responses aren't retried: the documented ones (`401`, `404`) repeat every time.                     |
