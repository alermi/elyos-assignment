import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import OpenAI from "openai";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems.mjs";
import { FunctionTool } from "openai/resources/responses/responses.mjs";
import {
    fetchResearch,
    fetchWeather,
    ResearchResponse,
    WeatherResponse,
} from "./api";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set in .env");
    process.exit(1);
}
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Placeholder shape; swap for the provider SDK's message type once chosen.
type Message = { role: "user" | "assistant" | "tool"; content: string };

const GET_WEATHER_FUNCTION_NAME = "get_weather";
const RESEARCH_TOPIC_FUNCTION_NAME = "research_topic";

const tools: FunctionTool[] = [
    {
        type: "function",
        name: GET_WEATHER_FUNCTION_NAME,
        description:
            "Get current weather for a city. Vague input locations will produce vague results. You should always validate the location returned, to validate if it is indeed the location you asked for.",
        parameters: {
            type: "object",
            properties: {
                location: {
                    type: "string",
                    description: "City name, e.g. London, UK",
                },
            },
            required: ["location"],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        type: "function",
        name: RESEARCH_TOPIC_FUNCTION_NAME,
        description:
            "Research a topic in depth. Use for questions requiring detailed research.",
        parameters: {
            type: "object",
            properties: {
                topic: {
                    type: "string",
                    description:
                        "Topic to research, e.g. 'solar energy', 'climate change', Must be less than 50 letters.",
                },
            },
            required: ["topic"],
            additionalProperties: false,
        },
        strict: true,
    },
];
/** Send input to LLM, handle tool calls, yield streaming response. */
async function* callLlm(
    userInput: string,
    conversationHistory: OpenAI.Responses.ResponseInputItem[],
    signal: AbortSignal,
): AsyncGenerator<string> {
    conversationHistory.push({ role: "user", content: userInput });

    while (true) {
        const stream = await client.responses.create(
            {
                model: "gpt-6-astra",
                input: conversationHistory,
                stream: true,
                tools,
            },
            { signal: signal },
        );

        let outputs: OpenAI.Responses.ResponseOutputItem[] = [];
        for await (const event of stream) {
            switch (event.type) {
                case "response.output_text.delta": {
                    yield event.delta;
                    break;
                }
                case "response.completed": {
                    outputs = event.response.output;
                    break;
                }
            }
        }

        conversationHistory.push(...toResponseInputItems(outputs));

        let calledTool = false;
        for (const item of outputs) {
            if (item.type !== "function_call") continue;

            if (item.name === GET_WEATHER_FUNCTION_NAME) {
                calledTool = true;
                const { location } = JSON.parse(item.arguments);
                //TODO: Error handling
                const weatherOutput = await getWeather(location, signal);
                const stringifiedOutput = JSON.stringify(weatherOutput);

                conversationHistory.push({
                    type: "function_call_output",
                    call_id: item.call_id,
                    output: stringifiedOutput,
                });
            }
            if (item.name === RESEARCH_TOPIC_FUNCTION_NAME) {
                calledTool = true;
                const { topic } = JSON.parse(item.arguments);
                //TODO: Error handling

                yield `Researching ${topic}... (Ctrl+C to cancel)\n`;
                const researchOutput = await researchTopic(topic, signal);
                const stringifiedOutput = JSON.stringify(researchOutput);

                conversationHistory.push({
                    type: "function_call_output",
                    call_id: item.call_id,
                    output: stringifiedOutput,
                });
            }
        }
        // No need to loop back, no tool call was done.
        if (!calledTool) return;
    }
}

type ToolOutput<T> = T | { error: string };

/** Fetch weather from API (~200ms). */
async function getWeather(
    location: string,
    signal: AbortSignal,
): Promise<ToolOutput<WeatherResponse>> {
    if (!location) {
        return {
            error: "Location is required",
        };
    }
    try {
        return await fetchWeather(location, signal);
    } catch (err) {
        if (signal.aborted) return { error: "Cancelled by the user" };
        //TODO: Error handling
        throw err;
    }
}

/** Research a topic (3-8 seconds). Should be cancellable. */
async function researchTopic(
    topic: string,
    signal: AbortSignal,
): Promise<ToolOutput<ResearchResponse>> {
    if (!topic) {
        return {
            error: "Topic is required",
        };
    }
    try {
        return await fetchResearch(topic, signal);
    } catch (err) {
        if (signal.aborted) return { error: "Cancelled by the user" };
        //TODO: Error handling
        throw err;
    }
}

const rl = readline.createInterface({ input, output });

/** Get input from user. */
async function getUserInput(): Promise<string> {
    return rl.question("You: ");
}

async function main(): Promise<void> {
    const conversationHistory: OpenAI.Responses.ResponseInputItem[] = [];

    let controller: AbortController | undefined;
    rl.on("SIGINT", () => controller?.abort());

    while (true) {
        const userInput = await getUserInput();
        if (["quit", "exit", "q"].includes(userInput.trim().toLowerCase()))
            break;

        controller = new AbortController();
        try {
            for await (const chunk of callLlm(
                userInput,
                conversationHistory,
                controller.signal,
            )) {
                output.write(chunk);
            }
        } catch (err) {
            if (!controller.signal.aborted) throw err;
        }
        if (controller.signal.aborted) output.write("\nCancelled (Ctrl + C)");
        output.write("\n");
    }

    rl.close();
}

main().catch((err) => {
    console.error(err); //let's not leak the error message for now it's unhandled
    rl.close();
    process.exit(1);
});
