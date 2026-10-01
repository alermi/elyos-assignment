// Streams speech from ElevenLabs and plays it while it is still being generated.
// Usage: npm run tts -- [text to speak]
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
    console.error("ELEVENLABS_API_KEY is not set in .env");
    process.exit(1);
}

const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // "George", one of the default voices
const SAMPLE_RATE = 24000;
const text =
    process.argv.slice(2).join(" ") ||
    "The weather in Tokyo is currently 22 degrees and sunny.";

const elevenlabs = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });

// Started before the request so its startup overlaps the network wait. Raw PCM has
// no container for ffplay to probe, so playback starts as soon as bytes arrive.
const player = spawn(
    "ffplay",
    [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nodisp",
        "-autoexit",
        "-f",
        "s16le",
        "-ar",
        String(SAMPLE_RATE),
        "-ch_layout",
        "mono",
        "-i",
        "-",
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
);
// ffplay can exit (Ctrl+C reaches it too) while a write is still pending
player.stdin.on("error", () => {});

// Ctrl+C stops the download and the playback, like a user interrupting the agent
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
controller.signal.addEventListener("abort", () => player.kill());

const start = performance.now();
const since = () => `${(performance.now() - start).toFixed(0)}ms`.padStart(7);
try {
    const audio = await elevenlabs.textToSpeech.stream(
        VOICE_ID,
        { text, modelId: "eleven_flash_v2_5", outputFormat: "pcm_24000" },
        { abortSignal: controller.signal },
    );
    console.log(`${since()}  response headers`);

    let bytes = 0;
    for await (const chunk of audio) {
        if (bytes === 0) console.log(`${since()}  first audio chunk`);
        bytes += chunk.length;
        player.stdin.write(chunk);
    }
    const seconds = bytes / 2 / SAMPLE_RATE; // 2 bytes per 16-bit sample
    console.log(`${since()}  last chunk (${seconds.toFixed(1)}s of audio)`);

    player.stdin.end();
    await once(player, "close");
    console.log(`${since()}  playback finished`);
} catch (err) {
    player.kill();
    if (!controller.signal.aborted) throw err;
    console.log(`${since()}  stopped`);
}
