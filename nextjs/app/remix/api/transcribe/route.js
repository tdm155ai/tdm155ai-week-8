import { env } from "../../../../lib/keys.mjs";

// POST { model, data, format, language } → { text }. `data` is one utterance as base64 audio (a WAV from the page).
// Every model goes through OpenRouter's speech-to-text endpoint with the OPENROUTER_API_KEY in the root .env, except
// "local-whisper", which goes to your own Whisper server at WHISPER_URL (for example whisper.cpp's whisper-server,
// http://127.0.0.1:8080/inference), so nothing leaves the computer.
// GET → which of the two is set up (yes or no only; never the keys).

export async function GET() {
  return Response.json({ openrouter: Boolean(await env("OPENROUTER_API_KEY")), local: Boolean(await env("WHISPER_URL")) });
}

async function openrouter({ model, data, format, language }) {
  const key = await env("OPENROUTER_API_KEY");
  if (!key) throw new Error("No OPENROUTER_API_KEY in the repo's .env.");
  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input_audio: { data, format }, ...(language ? { language } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `OpenRouter answered ${response.status}.`);
  return { text: body.text || "", cost: body.usage?.cost ?? null };
}

async function localWhisper({ data, format, language }) {
  const url = await env("WHISPER_URL");
  if (!url) throw new Error("No WHISPER_URL in the repo's .env.");
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(data, "base64")], { type: `audio/${format}` }), `utterance.${format}`);
  form.append("response_format", "json");
  if (language) form.append("language", language);
  const response = await fetch(url, { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `The Whisper server answered ${response.status}.`);
  return { text: (body.text || "").trim(), cost: 0 };
}

export async function POST(request) {
  const { model = "openai/gpt-4o-mini-transcribe", data, format = "wav", language = "" } = await request.json();
  if (typeof data !== "string" || !data) return Response.json({ error: "No audio." }, { status: 400 });
  try {
    const result = model === "local-whisper" ? await localWhisper({ data, format, language }) : await openrouter({ model, data, format, language });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
