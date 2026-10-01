// Streams audio to Deepgram live speech-to-text and prints what comes back.
// Usage: npm run stt -- [mic | <audio file or URL>]
// With no argument, ffmpeg synthesizes a short spoken sample, so no microphone is needed.
import { spawn, spawnSync } from "node:child_process";
import { DeepgramClient } from "@deepgram/sdk";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
if (!DEEPGRAM_API_KEY) {
    console.error("DEEPGRAM_API_KEY is not set in .env");
    process.exit(1);
}

const SAMPLE_RATE = 16000;
const SAMPLE_TEXT =
    "What is the weather in Tokyo today? Then research renewable energy trends.";

/** ffmpeg arguments that read the requested source. */
function inputArgs(source: string | undefined): string[] {
    // Files are read at real-time speed (-re) so they behave like a live stream
    if (source === undefined)
        return ["-re", "-f", "lavfi", "-i", `flite=text='${SAMPLE_TEXT}':voice=slt`];
    if (source === "mic")
        return ["-f", "dshow", "-audio_buffer_size", "50", "-i", `audio=${microphone()}`];
    return ["-re", "-i", source];
}

/** Windows (DirectShow) has no "default" device: use MIC_DEVICE or the first one ffmpeg lists. */
function microphone(): string {
    if (process.env.MIC_DEVICE) return process.env.MIC_DEVICE;
    const { stderr } = spawnSync(
        "ffmpeg",
        ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
        { encoding: "utf8" },
    );
    const device = stderr.match(/"(.+)" \(audio\)/)?.[1];
    if (!device) throw new Error("ffmpeg found no microphone");
    console.log(`Using microphone "${device}"`);
    return device;
}

const deepgram = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY });
const connection = await deepgram.listen.v1.connect({
    model: "nova-3",
    // Raw audio has no header, so Deepgram must be told its format
    encoding: "linear16",
    sample_rate: SAMPLE_RATE,
    channels: 1,
    interim_results: "true",
    smart_format: "true",
    endpointing: 300, // ms of silence before a result is marked speech_final
    utterance_end_ms: 1000, // UtteranceEnd after a 1 s gap between words (needs interim_results)
    vad_events: "true", // SpeechStarted: the cue to stop speaking when the user interrupts
});

// Seconds of audio sent so far. linear16 mono is 2 bytes per sample.
let bytesSent = 0;
const sentSeconds = () => bytesSent / (2 * SAMPLE_RATE);

// A long utterance arrives as several is_final pieces. Collect them until the speaker pauses.
let utterance: string[] = [];
function endUtterance(reason: string): void {
    if (utterance.length === 0) return;
    console.log(`>>> utterance (${reason}): ${utterance.join(" ")}`);
    utterance = [];
}

connection.on("message", (message) => {
    const time = `${sentSeconds().toFixed(2)}s`.padStart(7);
    switch (message.type) {
        case "Results": {
            const { transcript, words } = message.channel.alternatives[0];
            const lastWord = words.at(-1);
            if (!lastWord) return; // no speech in this window
            const kind = message.speech_final
                ? "speech_final"
                : message.is_final
                  ? "is_final"
                  : "interim";
            // Audio is sent in real time, so this is how long after the last word was spoken it arrived
            const lag = sentSeconds() - lastWord.end;
            console.log(
                `${time}  ${kind.padEnd(12)} lag ${lag.toFixed(2)}s  ${transcript}`,
            );
            if (message.is_final) utterance.push(transcript);
            if (message.speech_final) endUtterance("speech_final");
            break;
        }
        case "UtteranceEnd":
            console.log(`${time}  UtteranceEnd`);
            endUtterance("UtteranceEnd");
            break;
        case "SpeechStarted":
            console.log(`${time}  SpeechStarted`);
            break;
        case "Metadata":
            console.log(`${time}  Metadata: request ${message.request_id}`);
            break;
    }
});
connection.on("error", (err) => console.error("Deepgram error:", err.message));
const closed = new Promise<void>((resolve) =>
    connection.on("close", () => resolve()),
);

connection.connect();
await connection.waitForOpen();

const ffmpeg = spawn(
    "ffmpeg",
    [
        "-hide_banner",
        "-loglevel",
        "error",
        ...inputArgs(process.argv[2]),
        // 16-bit little-endian PCM (linear16), mono, at SAMPLE_RATE, written to stdout
        "-f",
        "s16le",
        "-ar",
        String(SAMPLE_RATE),
        "-ac",
        "1",
        "-",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
);
// Ctrl+C stops the audio. Deepgram still returns results for what it already received.
process.on("SIGINT", () => ffmpeg.kill());

for await (const chunk of ffmpeg.stdout) {
    connection.sendMedia(chunk);
    bytesSent += chunk.length;
}
// No more audio: CloseStream makes Deepgram send its last results, then close the socket
connection.sendCloseStream({ type: "CloseStream" });
await closed;
