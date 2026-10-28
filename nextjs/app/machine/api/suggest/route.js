import { env } from "../../../../lib/keys.mjs";

// Used by the multi-mic machine at /machine/multi (the simple machine itself has no AI producer).
// POST { model, instructions, context, transcript } → { text }. Sends the producer's instructions, the pre-interview
// notes, and the live transcript so far to a chat model on OpenRouter, and returns its follow-up questions as text.
// Only the end of a long transcript is sent.

export async function POST(request) {
  const { model = "anthropic/claude-haiku-5.5", instructions = "", context = "", transcript = "" } = await request.json();
  const key = await env("OPENROUTER_API_KEY");
  if (!key) return Response.json({ error: "No OPENROUTER_API_KEY in the repo's .env." }, { status: 500 });
  const recent = transcript.length > 16000 ? `[…]\n${transcript.slice(-16000)}` : transcript;
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: `Pre-interview notes:\n${context.trim() || "(none)"}\n\nLive transcript so far:\n${recent.trim() || "(nothing yet)"}` },
      ],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return Response.json({ error: body.error?.message || `OpenRouter answered ${response.status}.` }, { status: 502 });
  return Response.json({ text: body.choices?.[0]?.message?.content || "", cost: body.usage?.cost ?? null });
}
