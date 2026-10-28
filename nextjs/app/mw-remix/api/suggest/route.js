import { env } from "../../../../lib/keys.mjs";
import { asks, suggestMessage, suggestRequest } from "../../prompts.mjs";

// POST { model, mode, instructions, context, transcript, excerpt, note, around } → { text, sources, cost }.
// The producer's instructions go to a chat model on OpenRouter as the system prompt, with the pre-interview notes and
// the live transcript so far (only the end of a long one). `mode` says what's wanted:
// - "starter": one opening question for the host, before or at the start of the interview.
// - "question": follow-up questions about `excerpt`, a passage the producer highlighted in the transcript, steered by
//   `note` (one line from the producer, optional).
// - "research": check or look into `excerpt` (a claim someone made), steered by `note`. The request turns on
//   OpenRouter's web search, so the model can look things up; `sources` lists what it cited.
// - "beatsheet": a one-page producer's beat sheet for the host, in Markdown, from the notes and the transcript.
// - "plain": one unframed question about `excerpt`, from only `around` (the transcript lines near it) and `note`;
//   `instructions`, `context`, and `transcript` are ignored.
// The prompts themselves are in ../../prompts.mjs, which the page shows.

export async function POST(request) {
  const { model = "anthropic/claude-haiku-5.5", mode = "question", instructions = "", context = "", transcript = "", excerpt = "", note = "", around = "" } = await request.json();
  const key = await env("OPENROUTER_API_KEY");
  if (!key) return Response.json({ error: "No OPENROUTER_API_KEY in the repo's .env." }, { status: 500 });
  if (!asks[mode]) return Response.json({ error: `Unknown mode "${mode}".` }, { status: 400 });
  if (!["starter", "beatsheet"].includes(mode) && !excerpt.trim()) return Response.json({ error: "Nothing highlighted." }, { status: 400 });
  if (mode === "beatsheet" && !transcript.trim() && !context.trim()) return Response.json({ error: "Nothing to work from yet: record something or add notes first." }, { status: 400 });
  const message = suggestMessage({ mode, context, transcript, excerpt, note, around });
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(suggestRequest({ model, mode, instructions, message })),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return Response.json({ error: body.error?.message || `OpenRouter answered ${response.status}.` }, { status: 502 });
  const reply = body.choices?.[0]?.message || {};
  const sources = (reply.annotations || [])
    .filter((item) => item.type === "url_citation" && item.url_citation?.url)
    .map((item) => ({ title: item.url_citation.title || item.url_citation.url, url: item.url_citation.url }));
  return Response.json({ text: reply.content || "", sources, cost: body.usage?.cost ?? null });
}
