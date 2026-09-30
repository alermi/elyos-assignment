import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

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
    conversationHistory: Message[],
    signal: AbortSignal,
): AsyncGenerator<string> {
    // TODO: stream from the LLM, run tool calls, pass `signal` to SDK + fetch
    yield "";
}

/** Fetch weather from API (~200ms). */
async function getWeather(
    location: string,
    signal?: AbortSignal,
): Promise<unknown> {
    // TODO
    return {};
}

/** Research a topic (3-8 seconds). Should be cancellable. */
async function researchTopic(
    topic: string,
    signal?: AbortSignal,
): Promise<unknown> {
    // TODO
    return {};
}

async function main(): Promise<void> {
    const conversationHistory: Message[] = [];

    while (true) {
        const userInput = await getUserInput();
        if (["quit", "exit", "q"].includes(userInput.trim().toLowerCase()))
            break;

        // How do you handle cancellation while streaming?
        // How do you show pending state during slow tool calls?
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

main();
