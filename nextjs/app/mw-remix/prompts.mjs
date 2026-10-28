// Everything the machine tells the AI, in one place, so the page can show it exactly as it's sent. The page
// (Machine.jsx) and both server routes (api/transcribe, api/suggest) import this file; change it here and both change.

// Transcription: the hint sent with every utterance. Speech-to-text models use it to spell names and terms the way
// you'd expect (it isn't an instruction; the model only transcribes). The page lets the producer edit it; this is the
// default, built from the speakers' names.
export function defaultHints(names) {
  return `Speakers: ${names.join(" and ")}, in a podcast interview about a creative project and how AI was used in it.`;
}

// What the transcription route sends to OpenRouter (or to a local Whisper server), shown on the page. `data` is one
// utterance, a 16 kHz mono WAV, base64. OpenAI's models take the hint as `prompt` through OpenRouter's provider
// options; the others don't take one.
export function transcriptionRequest({ model, language, prompt }) {
  const body = { model, input_audio: { data: "<one utterance: 16 kHz mono WAV, base64>", format: "wav" }, ...(language ? { language } : {}) };
  if (model.startsWith("openai/") && prompt) body.provider = { options: { openai: { prompt } } };
  return body;
}

// Questions and research: the system prompt. The producer can edit it on the page.
export const defaultInstructions = `You help the producer of a live podcast interview. A student (the guest) is being interviewed by another student (the host) about a creative project: the choices they made, how they used AI, and what they added as a person.

You'll get the pre-interview notes, the live transcript so far, and what the producer wants right now: an opening question, follow-up questions about a passage they highlighted, or a check on something that was said.

When suggesting questions:
- Stay close to the highlighted passage and to what the guest just said.
- Ask for specific moments and examples rather than general claims ("Show me the moment that decision happened").
- Questions about AI should get at judgment: what they threw out, how they knew it wasn't good enough, what a beginner would have done differently.
- One question per line, no numbering, no preamble.

When checking something:
- Say plainly what you could confirm, what you couldn't, and what the host should know before following up. Don't pad.`;

// The unframed question. When the producer highlights a passage for questions, a second request goes out alongside
// the framed one, with none of the above: only this line as the system prompt, the passage, the few transcript lines
// around it, and the producer's note. It comes back as one question tagged "Unframed", for comparison.
export const plainInstructions = "You write one interview question. You know nothing about the show, the speakers, or any project: only the lines you're given and the producer's note. Reply with the question only.";

// The ask for each mode, which ends the user message. EXCERPT is the passage the producer highlighted and NOTE is the
// producer's one-line note (left out when there isn't one).
export const asks = {
  starter: "The interview is about to start (or has just started). Suggest ONE opening question for the host: specific, warm, and drawn from the pre-interview notes. Reply with the question only.",
  question: "The producer highlighted this passage of the transcript:\n\n«EXCERPT»\n\nNOTE\n\nSuggest two short follow-up questions about this passage. One question per line, no numbering, no preamble.",
  plain: "The producer highlighted this:\n\n«EXCERPT»\n\nNOTE\n\nWrite one short follow-up question about exactly what was said there: have the speaker unpack a term, a claim, or a move they made, in their own words.",
  beatsheet: "Write the producer's beat sheet for the host: one page, in Markdown, that helps the host interview this guest as cleanly as possible when they go live. Draw everything from the notes and the transcript; don't invent. Use exactly these sections, each short:\n\n## The guest\nTwo or three lines: who they are and what they made, in their own words where you can.\n\n## The one thing\nThe single most interesting thing in the conversation, in one sentence. The interview should get there.\n\n## Beats\nFour to six beats, in the order the host should take them. Each is a one-line heading in bold, then one line on the moment or example to ask for.\n\n## Questions\nThe five or six best questions, one per line. Specific, in plain speech, ready to read out loud.\n\n## Names and terms\nPeople, titles, places, and terms the host should say right, with a few words on each.\n\n## Handle with care\nAnything the host should steer around or come to gently, or (none).\n\n## Check before air\nClaims or facts from the conversation worth verifying, or (none).\n\nNo preamble, no closing line, nothing outside those sections.",
  research: "The producer highlighted this passage of the transcript and wants it checked or looked into:\n\n«EXCERPT»\n\nNOTE\n\nAnswer in ONE short paragraph, under 70 words, plain text with no headings, bold, lists, or links: what can be verified, what's uncertain, and what the host should know before following up. Don't cite sources in the text; the pages you used are attached separately.",
};

function fill(mode, excerpt, note) {
  return asks[mode].replace("EXCERPT", excerpt.trim()).replace("NOTE", note.trim() ? `The producer adds: ${note.trim()}` : "").replace(/\n{3,}/g, "\n\n");
}

// Documents the producer uploaded under Setup (Markdown or text: a context repository's README, an earlier
// transcript, notes), as one block. Each is cut at 24,000 characters so a long one can't crowd out the rest.
function documentsBlock(documents) {
  const items = (documents || []).filter((doc) => doc && doc.text && doc.text.trim());
  if (!items.length) return "";
  return `Documents the producer uploaded:\n\n${items.map((doc) => `### ${doc.name || "Untitled"}\n${doc.text.length > 24000 ? `${doc.text.slice(0, 24000)}\n[…]` : doc.text.trim()}`).join("\n\n")}\n\n`;
}

// The user message: the uploaded documents (if any), the notes, the transcript (only the end of a long one), then the
// ask. For the unframed question ("plain"), only the lines around the passage (`around`), then the ask.
export function suggestMessage({ mode, context = "", transcript = "", excerpt = "", note = "", around = "", documents = [] }) {
  if (mode === "plain") return `The lines around it:\n${around.trim() || "(none)"}\n\n${fill(mode, excerpt, note)}`;
  const recent = transcript.length > 16000 ? `[…]\n${transcript.slice(-16000)}` : transcript;
  return `${documentsBlock(documents)}Pre-interview notes:\n${context.trim() || "(none)"}\n\nLive transcript so far:\n${recent.trim() || "(nothing yet)"}\n\n${fill(mode, excerpt, note)}`;
}

// What the suggest route sends to OpenRouter, shown on the page. Research turns on OpenRouter's web search (the Exa
// engine, which cites its sources), which costs a little more per call.
export function suggestRequest({ model, mode, instructions, message }) {
  return {
    model,
    max_tokens: mode === "research" ? 1000 : mode === "beatsheet" ? 2500 : mode === "plain" ? 200 : 500,
    ...(mode === "research" ? { plugins: [{ id: "web", engine: "exa", max_results: 5 }] } : {}),
    messages: [
      { role: "system", content: mode === "plain" ? plainInstructions : instructions },
      { role: "user", content: message },
    ],
  };
}
