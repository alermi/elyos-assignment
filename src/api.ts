const BASE_URL = process.env.ELYOS_BASE_URL;
if (!BASE_URL) {
    console.error("BASE_URL is not set in .env");
    process.exit(1);
}
const API_KEY = process.env.ELYOS_API_KEY;
if (!API_KEY) {
    console.error("ELYOS_API_KEY is not set in .env");
    process.exit(1);
}

// Although this request is usually fast, it can take a long time after a cold period
const WEATHER_API_TIMEOUT_MS = 8000;
const RESEARCH_API_TIMEOUT_MS = 9000;

type WeatherResponse = {
    location: string;
    temperature_c: number;
    condition: string;
    humidity: number;
};
//TODO: Consider zod validation
export async function fetchWeather(
    location: string,
    abortSignal: AbortSignal,
): Promise<WeatherResponse> {
    const body = await fetchElyosData(
        "weather",
        { location },
        WEATHER_API_TIMEOUT_MS,
        abortSignal,
    );
    // Some responses replace the top-level fields with a `conditions` array of two
    // contradictory readings. The API doesn't say which is right, but form the trials,
    // the first has always matched the normal response. For now, we can pick the
    // first return. Alternatively, we could re-try if we see an outliar.
    const reading = Array.isArray(body.conditions) ? body.conditions[0] : body;
    if (typeof reading?.temperature_c !== "number")
        throw new ElyosApiError("Unexpected weather response", true);

    return {
        location: body.location,
        temperature_c: reading.temperature_c,
        condition: reading.condition,
        humidity: reading.humidity,
    };
}

type ResearchResponse = {
    topic: string;
    summary: string;
    sources: string[];
};

// Longer topics are silently cut mid-word, and only the cut text is researched
const RESEARCH_TOPIC_MAX_LENGTH = 50;

export async function fetchResearch(
    topic: string,
    abortSignal: AbortSignal,
): Promise<ResearchResponse> {
    // TODO: Instruct the agent of this max length before a tool call is made.
    if (topic.length > RESEARCH_TOPIC_MAX_LENGTH)
        throw new ElyosApiError(
            `Topic is too long (${topic.length} characters). Use ${RESEARCH_TOPIC_MAX_LENGTH} or fewer.`,
            false,
        );

    const body = await fetchElyosData(
        "research",
        { topic },
        RESEARCH_API_TIMEOUT_MS,
        abortSignal,
    );
    // Some responses return an empty {} with a 200 status. We should retry these.
    if (typeof body.summary !== "string")
        throw new ElyosApiError("Research returned an empty result", true);

    // Some responses are an outdated summary from 2024 marked `cached: true`.
    // Repeating the request usually returns a fresh one. Made the decision to retry
    // but alternatively, we could just return it to the agent.
    if (body.cached === true)
        throw new ElyosApiError("Research returned an outdated result", true);

    return {
        topic: body.topic,
        summary: body.summary,
        sources: body.sources,
    };
}
export class ElyosApiError extends Error {
    readonly retryable: boolean;

    constructor(message: string, retryable: boolean) {
        super(message);
        this.name = "ElyosApiError";
        this.retryable = retryable;
    }
}

export class RateLimitError extends ElyosApiError {
    readonly retryAfterSeconds: number;

    constructor(retryAfterSeconds: number) {
        super(`Rate limited, retry in ${retryAfterSeconds}s`, true);
        this.name = "RateLimitError";
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

async function fetchElyosData(
    path: string,
    params: Record<string, string>,
    timeoutMs: number,
    abortSignal: AbortSignal,
): Promise<Record<string, any>> {
    const url = new URL(path, BASE_URL);
    url.search = new URLSearchParams(params).toString();

    let res: Response;
    try {
        res = await fetch(url, {
            headers: { "X-API-Key": API_KEY! },
            signal: AbortSignal.any([
                AbortSignal.timeout(timeoutMs),
                abortSignal,
            ]),
        });
    } catch (err) {
        // TODO: Decide if we should throw when aborted or return Promise.reject
        if (abortSignal.aborted) throw err; // user cancelled: never retry
        throw new ElyosApiError(
            `Could not reach the Elyos API: ${(err as Error).message}`,
            true,
        );
    }
    const body = await res.json();
    // Every documented non-OK status (401 bad key, 404 location not found) gives the same result on retry. Do not retry
    if (!res.ok)
        throw new ElyosApiError(
            body?.error ?? `Elyos API returned HTTP ${res.status}`,
            false,
        );
    // Rate limiting is a 200 with {"status":"throttled"}. Extract the time remaining and return specialized error
    if (body?.status === "throttled")
        throw new RateLimitError(Number(body.retry_after_seconds) || 30);
    return body;
}
