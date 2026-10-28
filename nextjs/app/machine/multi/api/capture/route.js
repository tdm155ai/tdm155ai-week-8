import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Native capture for the multi-mic machine, because browsers usually stop at 2 channels. The server runs ffmpeg on
// this Mac (Homebrew's ffmpeg), captures every channel of the chosen input, and:
// - streams it to the page as raw 32-bit float samples, interleaved, at 16 kHz (headers: x-channels, x-rate, x-file);
// - saves the whole session, at full quality, as one multichannel WAV in the repo's _media/ folder (gitignored).
// The page stops the capture by closing the request; ffmpeg then finishes the WAV.
//
// GET → the Mac's audio inputs, as ffmpeg numbers them: { devices: [{ index, name }] }.
// GET ?device=<index> → the capture stream.
// macOS asks once for microphone access for the app the server runs in (Terminal, for example).

const repoRoot = path.dirname(/* turbopackIgnore: true */ process.cwd());
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

// ffmpeg writes a channel count ("8 channels") or a layout name ("stereo", "7.1"); a layout name gives the count.
const layouts = { mono: 1, stereo: 2, "2.1": 3, "3.0": 3, quad: 4, "4.0": 4, "5.0": 5, "5.0(side)": 5, "5.1": 6, "5.1(side)": 6, hexagonal: 6, "6.1": 7, "7.0": 7, "7.1": 8, octagonal: 8 };
function channelCount(description) {
  return Number(description.match(/^(\d+) channels/)?.[1]) || layouts[description] || 0;
}

function listDevices() {
  return new Promise((resolve) => {
    const child = spawn(/* turbopackIgnore: true */ ffmpeg, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]);
    let text = "";
    child.stderr.on("data", (chunk) => { text += chunk; });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const audio = text.split(/AVFoundation audio devices:/)[1] || "";
      resolve([...audio.matchAll(/\[(\d+)\] (.+)/g)].map(([, index, name]) => ({ index: Number(index), name: name.trim() })));
    });
  });
}

export async function GET(request) {
  const device = new URL(request.url).searchParams.get("device");
  if (device === null) {
    const devices = await listDevices();
    return devices ? Response.json({ devices }) : Response.json({ error: "ffmpeg isn't installed (brew install ffmpeg)." }, { status: 500 });
  }
  if (!/^\d+$/.test(device)) return Response.json({ error: "Choose an input." }, { status: 400 });

  const folder = path.join(repoRoot, "_media", "multi");
  await mkdir(/* turbopackIgnore: true */ folder, { recursive: true });
  const file = path.join(folder, `${new Date().toISOString().replace(/[:.]/g, "-")}.wav`);
  const child = spawn(/* turbopackIgnore: true */ ffmpeg, [
    "-hide_banner", "-loglevel", "info", "-f", "avfoundation", "-i", `:${device}`,
    "-map", "0:a", "-c:a", "pcm_s24le", file,
    "-map", "0:a", "-ar", "16000", "-f", "f32le", "pipe:1",
  ], { stdio: ["pipe", "pipe", "pipe"] });

  // ffmpeg names the channel count on stderr ("Stream #0:0: Audio: …, 48000 Hz, 8 channels, …") before audio flows.
  const channels = await new Promise((resolve) => {
    let text = "";
    const timer = setTimeout(() => resolve(0), 8000);
    child.stderr.on("data", (chunk) => {
      text += chunk;
      const match = text.match(/Stream #0:0[^\n]*Audio:[^\n]*?Hz, ([^,\n]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(channelCount(match[1].trim()));
      }
    });
    child.on("close", () => { clearTimeout(timer); resolve(0); });
    child.on("error", () => { clearTimeout(timer); resolve(0); });
  });
  if (!channels) {
    child.kill("SIGKILL");
    return Response.json({ error: "ffmpeg couldn't open that input. If macOS asked for microphone access, allow it and try again." }, { status: 500 });
  }

  const stop = () => { if (child.exitCode === null) child.stdin.write("q"); };
  request.signal.addEventListener("abort", stop);
  const body = new ReadableStream({
    start(controller) {
      child.stdout.on("data", (chunk) => { try { controller.enqueue(new Uint8Array(chunk)); } catch {} });
      child.on("close", () => { try { controller.close(); } catch {} });
    },
    cancel: stop,
  });
  return new Response(body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-channels": String(channels),
      "x-rate": "16000",
      "x-file": path.relative(repoRoot, file),
    },
  });
}
