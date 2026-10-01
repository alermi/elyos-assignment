import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import OpenAI from "openai";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems.mjs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set in .env");
    process.exit(1);
}
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Placeholder shape; swap for the provider SDK's message type once chosen.
type Message = { role: "user" | "assistant" | "tool"; content: string };

const rl = readline.createInterface({ input, output });

/** Get input from user. */
async function getUserInput(): Promise<string> {
    return rl.question("You: ");
}

/** Send input to LLM, handle tool calls, yield streaming response. */
async function* callLlm(
    userInput: string,
    conversationHistory: OpenAI.Responses.ResponseInputItem[],
    signal: AbortSignal,
): AsyncGenerator<string> {
    // TODO: stream from the LLM, run tool calls, pass `signal` to SDK + fetch
    conversationHistory.push({ role: "user", content: userInput });
    const stream = await client.responses.create(
        {
            model: "gpt-6-astra",
            input: conversationHistory,
            stream: true,
        },
        { signal: signal },
    );

    // There can be multiple outputs when tool calls are involved.
    let outputs: OpenAI.Responses.ResponseOutputItem[] = [];
    for await (const event of stream) {
        switch (event.type) {
            case "response.output_text.delta":
                yield event.delta;
                break;
            case "response.completed":
                outputs = event.response.output;
                break;
        }
    }

    conversationHistory.push(...toResponseInputItems(outputs));
}

/** Fetch weather from API (~200ms). */
async function getWeather(
    location: string,
    signal?: AbortSignal,
): Promise<unknown> {
    if (!location) {
        return {
            error: "Location is required",
        };
    }
    // TODO
    return {};
}

/** Research a topic (3-8 seconds). Should be cancellable. */
async function researchTopic(
    topic: string,
    signal?: AbortSignal,
): Promise<unknown> {
    if (!topic) {
        return {
            error: "Topic is required",
        };
    }
    // TODO
    return {};
}

const rl = readline.createInterface({ input, output });

/** Get input from user. */
async function getUserInput(): Promise<string> {
    return rl.question("You: ");
}

async function main(): Promise<void> {
    const conversationHistory: OpenAI.Responses.ResponseInputItem[] = [];

    while (true) {
        const userInput = await getUserInput();
        if (["quit", "exit", "q"].includes(userInput.trim().toLowerCase()))
            break;

        // TODO: How do you handle cancellation while streaming?
        // TODO: How do you show pending state during slow tool calls?
        const controller = new AbortController();
        for await (const chunk of callLlm(
            userInput,
            conversationHistory,
            controller.signal,
        )) {
            output.write(chunk);
        }
        output.write("\n");
    }

    rl.close();
}

main().catch(() => {
    console.error("Unexpected error."); //let's not leak the error message for now it's unhandled
    rl.close();
    process.exit(1);
});
