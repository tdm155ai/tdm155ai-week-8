"use client";

import { useEffect, useRef, useState } from "react";
import { askPermission, base64, listInputs, Recorder } from "./recorder.mjs";
import styles from "./machine.module.css";
import { asks, defaultHints, defaultInstructions, plainInstructions, suggestMessage, suggestRequest, transcriptionRequest } from "./prompts.mjs";

// The recording and interviewing machine. It records from an audio interface (or any microphone), transcribes each
// utterance as it ends, and helps the producer: one starter question to open with, then, whenever the producer
// highlights part of the transcript, follow-up questions about that passage or a check on a claim in it (with a
// one-line note steering either). Everything on the page is kept in this browser (localStorage), so a reload doesn't
// lose the session. Everything it sends to the AI is in prompts.mjs and shown on the page under "What gets sent".
//
// Anything the AI contributed that reaches the conversation is flagged in the transcript as AI-sourced: a question
// the host reads out is recognized when it's transcribed (it matches a suggestion), and Asked / Used logs a suggestion
// the host took up without reading it word for word. Either way the suggestion then leaves the list, as does a skipped
// one, so the newest suggestions are always at the top. Every other line is organic, and any line can be re-marked.

const kinds = [
  ["pre-interview", "Pre-interview", "The producer talks with the guest before the interview, to learn what the project is and what to ask about. When it's done, its transcript becomes the pre-interview notes."],
  ["practice", "Practice run", "A dry run of the interview, with the pre-interview notes in hand."],
  ["interview", "Live interview", "The real thing: host and guest on microphones, the producer passing follow-ups."],
];

const transcriptionModels = [
  ["openai/gpt-4o-mini-transcribe", "GPT-4o mini transcribe (fast, the default)"],
  ["openai/gpt-4o-transcribe", "GPT-4o transcribe (more accurate)"],
  ["elevenlabs/scribe-v2", "ElevenLabs Scribe v2"],
  ["mistralai/voxtral-mini-transcribe-3-0", "Voxtral mini transcribe (cheapest)"],
  ["local-whisper", "Local Whisper (WHISPER_URL)"],
];

const suggestModels = [
  ["anthropic/claude-haiku-5.5", "Claude Haiku 5.5 (fast)"],
  ["anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5"],
  ["anthropic/claude-opus-5.5", "Claude Opus 5.5"],
];

const labels = { starter: "Starter", question: "Question", plain: "Unframed", research: "Research", beatsheet: "Beat sheet" };

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sourceLabel(line) {
  return line.kind === "research" ? "AI research" : "AI question";
}

function transcriptText(lines, names) {
  return lines.filter((line) => line.text).map((line) => `${names[line.channel]} (${clock(line.start)})${line.source === "ai" ? ` [${sourceLabel(line)}]` : ""}: ${line.text}`).join("\n");
}

function short(text, max = 80) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Did someone say this suggestion out loud? Most of the suggestion's words (ignoring short ones) appear in the line.
function words(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter((word) => word.length > 2);
}

function spoken(text, suggestion) {
  const wanted = words(suggestion);
  if (wanted.length < 3) return false;
  const said = new Set(words(text));
  return wanted.filter((word) => said.has(word)).length / wanted.length >= 0.6;
}

export default function Machine({ apiBase, storageKey }) {
  const store = (name) => `${storageKey}:${name}`;
  const [ready, setReady] = useState(false);
  const [inputs, setInputs] = useState([]);
  const [settings, setSettings] = useState({
    deviceId: "",
    mode: "split",
    names: ["Host", "Guest"],
    kind: "interview",
    model: "openai/gpt-4o-mini-transcribe",
    language: "en",
    threshold: 0.02,
    auto: true,
    bleedGate: true,
    suggestModel: "anthropic/claude-haiku-5.5",
    hints: "",
  });
  const [lines, setLines] = useState([]);
  const [context, setContext] = useState("");
  // Markdown or text files uploaded under Setup, sent with every framed request: [{ name, text }].
  const [documents, setDocuments] = useState([]);
  const [instructions, setInstructions] = useState(defaultInstructions);
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState("");
  const [card, setCard] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState([-60, -60]);
  const [thresholds, setThresholds] = useState([]);
  const [channels, setChannels] = useState(0);
  const [keys, setKeys] = useState(null);
  const [error, setError] = useState("");
  const [audio, setAudio] = useState(null);
  // The highlighted passage of the transcript, and the note typed under it.
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState("");
  const [pickMode, setPickMode] = useState("question");

  const recorder = useRef(null);
  const started = useRef(0);
  const transcriptRef = useRef(null);
  const latest = useRef({});
  latest.current = { settings, lines, context, documents, instructions, suggestions, elapsed, recording };

  // Restore the last session from this browser, then keep saving it.
  useEffect(() => {
    setSettings((current) => ({ ...current, ...load(store("settings"), {}) }));
    setLines(load(store("lines"), []).filter((line) => !line.pending));
    setContext(load(store("context"), ""));
    setDocuments(load(store("documents"), []));
    setInstructions(load(store("instructions"), defaultInstructions));
    setSuggestions(load(store("suggestions"), []).map((item) => ({ kind: "question", ...item })));
    setReady(true);
    fetch(`${apiBase}/transcribe`).then((r) => r.json()).then(setKeys).catch(() => setKeys({ openrouter: false, local: false }));
    listInputs().then(setInputs).catch(() => {});
  }, []);
  useEffect(() => { if (ready) save(store("settings"), settings); }, [ready, settings]);
  useEffect(() => { if (ready) save(store("lines"), lines); }, [ready, lines]);
  useEffect(() => { if (ready) save(store("context"), context); }, [ready, context]);
  useEffect(() => { if (ready) save(store("documents"), documents); }, [ready, documents]);
  useEffect(() => { if (ready) save(store("instructions"), instructions); }, [ready, instructions]);
  useEffect(() => { if (ready) save(store("suggestions"), suggestions); }, [ready, suggestions]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((performance.now() - started.current) / 1000), 250);
    return () => clearInterval(timer);
  }, [recording]);

  // Live changes to speech detection and the bleed gate apply while recording.
  useEffect(() => {
    if (recorder.current) Object.assign(recorder.current.settings, { auto: settings.auto, threshold: settings.threshold, bleedGate: settings.bleedGate });
  }, [settings.auto, settings.threshold, settings.bleedGate]);

  // Highlighting in the transcript: when the mouse comes up on a selection inside it, the Question / Research popover
  // appears under the selection. A click elsewhere (not in the popover) closes it.
  useEffect(() => {
    function onMouseUp(event) {
      if (event.target.closest?.("[data-popover]")) return;
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        const list = transcriptRef.current;
        if (!text || !selection.rangeCount || !list?.contains(selection.anchorNode)) return setPick(null);
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const host = list.parentElement.getBoundingClientRect();
        setPick({ text, top: rect.bottom - host.top + 8, left: Math.max(0, Math.min(rect.left - host.left, host.width - 340)) });
        setNote("");
      }, 0);
    }
    function onKeyDown(event) { if (event.key === "Escape") setPick(null); }
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mouseup", onMouseUp); document.removeEventListener("keydown", onKeyDown); };
  }, []);

  const set = (patch) => setSettings((current) => ({ ...current, ...patch }));

  // Upload context: Markdown or text files, read in the browser and kept with the session (up to about 400 KB in all).
  async function addDocuments(fileList) {
    const files = [...fileList];
    const read = await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
    setDocuments((current) => {
      const next = [...current.filter((doc) => !read.some((item) => item.name === doc.name)), ...read];
      const total = next.reduce((sum, doc) => sum + doc.text.length, 0);
      if (total > 400000) { setError("That's more than about 400 KB of documents in all; remove one or upload a shorter version."); return current; }
      return next;
    });
  }

  function removeDocument(name) {
    setDocuments((current) => current.filter((doc) => doc.name !== name));
  }

  async function findInputs() {
    try {
      await askPermission();
      setInputs(await listInputs());
    } catch (e) {
      setError(`Couldn't open the microphone: ${e.message}`);
    }
  }

  async function transcribe(segment, offset) {
    const id = newId();
    const line = { id, channel: settings.mode === "mix" ? 0 : segment.channel, start: offset + segment.start, text: "", pending: true };
    setLines((current) => [...current, line].sort((a, b) => a.start - b.start));
    try {
      const { model, language, names, hints } = latest.current.settings;
      const response = await fetch(`${apiBase}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, language, format: "wav", data: base64(segment.wav), prompt: hints.trim() || defaultHints(names) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Transcription failed (${response.status}).`);
      const text = body.text.trim();
      if (!text) return setLines((current) => current.filter((item) => item.id !== id));
      // A suggestion read out loud: flag the line as AI-sourced, mark the suggestion asked, and drop any line that
      // Asked had already logged for it (the spoken words replace it).
      const match = latest.current.suggestions.find((item) => item.kind !== "research" && spoken(text, item.text));
      setLines((current) => current
        .filter((item) => !(match && item.logged && item.suggestionId === match.id))
        .map((item) => item.id === id ? { ...item, text, pending: false, ...(match ? { source: "ai", kind: match.kind, suggestionId: match.id } : {}) } : item));
      if (match) dismiss(match.id);
    } catch (e) {
      setError(e.message);
      setLines((current) => current.filter((item) => item.id !== id));
    }
  }

  async function start() {
    setError("");
    setAudio(null);
    // A new recording continues the transcript's clock from where the last one ended.
    const offset = lines.length ? Math.max(...lines.map((line) => line.start)) + 1 : 0;
    const engine = new Recorder({
      onLevels: (dbs, marks) => { setLevels(dbs); setThresholds(marks); },
      onSegment: (segment) => transcribe(segment, offset),
    });
    try {
      const info = await engine.start(settings.deviceId, { mode: settings.mode, auto: settings.auto, threshold: settings.threshold, bleedGate: settings.bleedGate });
      recorder.current = engine;
      setChannels(info.channels);
      started.current = performance.now() - offset * 1000;
      setElapsed(offset);
      setRecording(true);
      if (!inputs.some((input) => input.label && !/^Input \d/.test(input.label))) listInputs().then(setInputs).catch(() => {});
    } catch (e) {
      setError(`Couldn't start recording: ${e.message}`);
    }
  }

  async function stop() {
    const engine = recorder.current;
    recorder.current = null;
    setRecording(false);
    setLevels([-60, -60]);
    setThresholds([]);
    const blob = await engine?.stop();
    if (blob) setAudio(blob);
  }

  // The transcript lines around a highlighted passage (three either side), for the unframed question.
  function around(excerpt) {
    const { lines, settings } = latest.current;
    const said = lines.filter((line) => line.text);
    const flat = excerpt.replace(/\s+/g, " ").trim();
    const probes = [flat.slice(0, 40), flat.slice(Math.max(0, flat.length / 2 - 20), flat.length / 2 + 20), flat.slice(-40)].map((p) => p.trim()).filter((p) => p.length > 8);
    const hits = said.map((line, i) => probes.some((p) => line.text.includes(p)) ? i : -1).filter((i) => i >= 0);
    const [from, to] = hits.length ? [Math.max(0, hits[0] - 3), Math.min(said.length, hits[hits.length - 1] + 4)] : [Math.max(0, said.length - 6), said.length];
    return transcriptText(said.slice(from, to), settings.names);
  }

  // Ask the AI: "starter" for one opening question, "question" or "research" about a highlighted passage. A question
  // ask sends two requests at once: the framed one (with the instructions, notes, and transcript) and the unframed
  // one ("plain": only the passage, the lines around it, and the note), whose single question leads the batch.
  async function ask(mode, excerpt = "", note = "") {
    const { settings, lines, context, instructions } = latest.current;
    setPick(null);
    setBusy(mode);
    const base = { model: settings.suggestModel, instructions, context, documents: latest.current.documents, transcript: transcriptText(lines, settings.names), excerpt, note };
    const modes = mode === "question" ? ["plain", "question"] : [mode];
    const results = await Promise.allSettled(modes.map(async (m) => {
      const response = await fetch(`${apiBase}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, mode: m, ...(m === "plain" ? { around: around(excerpt) } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `The AI failed (${response.status}).`);
      const texts = m === "research" || m === "plain"
        ? [body.text.trim()].filter(Boolean)
        : body.text.split("\n").map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
      return texts.map((text) => ({ id: newId(), kind: m, text: text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, ""), excerpt, note, sources: body.sources || [], state: "new", at: Date.now() }));
    }));
    const fresh = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    if (fresh.length) setSuggestions((current) => [...fresh, ...current].slice(0, 40));
    const failed = results.find((result) => result.status === "rejected");
    if (failed) setError(failed.reason.message);
    setBusy("");
  }

  // A suggestion leaves the list: used, read out, or skipped.
  function dismiss(id) {
    setSuggestions((current) => current.filter((item) => item.id !== id));
  }

  // The host took up a suggestion (read it out, paraphrased it, or showed it): log it in the transcript as AI-sourced,
  // unless the transcript already has it, and take it off the list.
  function use(item) {
    dismiss(item.id);
    const { lines, elapsed, recording } = latest.current;
    if (lines.some((line) => line.suggestionId === item.id)) return;
    const start = recording ? elapsed : lines.length ? Math.max(...lines.map((line) => line.start)) + 1 : 0;
    setLines((current) => [...current, { id: newId(), channel: 0, start, text: item.text, source: "ai", kind: item.kind, suggestionId: item.id, logged: true }].sort((a, b) => a.start - b.start));
  }

  function show(item) {
    setCard(item.text);
    use(item);
  }

  function toggleSource(id) {
    setLines((current) => current.map((line) => line.id === id ? (line.source === "ai" ? { ...line, source: undefined, kind: undefined } : { ...line, source: "ai" }) : line));
  }

  function editLine(id, text) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, text } : line));
  }

  function exportTranscript() {
    const kind = kinds.find(([key]) => key === settings.kind)?.[1] || "Session";
    const date = new Date().toISOString().slice(0, 10);
    const said = lines.filter((line) => line.text);
    const body = said.map((line) => `**${settings.names[line.channel]}** (${clock(line.start)})${line.source === "ai" ? ` *[${sourceLabel(line)}]*` : ""}: ${line.text}`).join("\n\n");
    const md = `---\ntitle: ${kind}, ${date}\nkind: ${settings.kind}\ntranscribed_by: ${settings.model}\nai_sourced_lines: ${said.filter((line) => line.source === "ai").length}\n---\n\n${body}\n`;
    download(`${settings.kind}-${date}.md`, new Blob([md], { type: "text/markdown" }));
  }

  // The producer's beat sheet: a one-page Markdown brief for the host, written by the AI from the notes and the
  // transcript (a pre-interview or a practice run, usually), downloaded like the transcript.
  async function exportBeatSheet() {
    const { settings, lines, context, instructions } = latest.current;
    setBusy("beatsheet");
    try {
      const response = await fetch(`${apiBase}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: settings.suggestModel, mode: "beatsheet", instructions, context, documents: latest.current.documents, transcript: transcriptText(lines, settings.names) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `The beat sheet failed (${response.status}).`);
      const date = new Date().toISOString().slice(0, 10);
      const md = `---\ntitle: Beat sheet, ${date}\nkind: beat-sheet\nfrom: ${settings.kind}\nwritten_by: ${settings.suggestModel}\n---\n\n${body.text.trim()}\n`;
      download(`${settings.kind}-${date}-beat-sheet.md`, new Blob([md], { type: "text/markdown" }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  function clearSession() {
    if (!confirm("Clear the transcript and suggestions? Download them first if you want to keep them.")) return;
    setLines([]);
    setSuggestions([]);
    setAudio(null);
    setElapsed(0);
    setPick(null);
  }

  const names = settings.mode === "mix" ? [settings.names[0]] : settings.names;
  const finished = lines.filter((line) => line.text);
  const aiSourced = finished.filter((line) => line.source === "ai").length;
  const thresholdDb = Math.round(20 * Math.log10(settings.threshold));
  const hints = settings.hints.trim() || defaultHints(settings.names);
  const sentForTranscription = settings.model === "local-whisper"
    ? { file: "<one utterance: 16 kHz mono WAV>", response_format: "json", ...(settings.language ? { language: settings.language } : {}), prompt: hints }
    : transcriptionRequest({ model: settings.model, language: settings.language, prompt: hints });
  const sentForQuestions = suggestRequest({ model: settings.suggestModel, mode: "question", instructions, message: suggestMessage({ mode: "question", documents: documents.length ? [{ name: "{each uploaded document}", text: "{its text}" }] : [], context: "{the pre-interview notes}", transcript: "{the transcript so far}", excerpt: "{the passage you highlighted}", note: "{your note, if any}" }) });
  const sentUnframed = suggestRequest({ model: settings.suggestModel, mode: "plain", instructions, message: suggestMessage({ mode: "plain", around: "{the transcript lines around the passage}", excerpt: "{the passage you highlighted}", note: "{your note, if any}" }) });

  return (
    <div className={styles.machine}>
      <div className={styles.stepStatic}>
        <span className={styles.stepNumber}>1</span>
        <span className={styles.stepTitle}><strong>What are you recording?</strong><small>{kinds.find(([key]) => key === settings.kind)?.[2]}</small></span>
        <div className={styles.kinds} role="group" aria-label="What you're recording">
          {kinds.map(([key, label]) => (
            <button key={key} type="button" className={settings.kind === key ? styles.kindOn : styles.kind} onClick={() => set({ kind: key })} aria-pressed={settings.kind === key}>{label}</button>
          ))}
        </div>
      </div>

      <details className={styles.step} open={!recording && !lines.length}>
        <summary><span className={styles.stepNumber}>2</span><span className={styles.stepTitle}><strong>Technical setup</strong><small>Which input, who is on each microphone, and how speech is transcribed</small></span><span className={styles.stepCaret} aria-hidden="true" /></summary>
        <div className={styles.fields}>
          <label>Input
            <span className={styles.row}>
              <select value={settings.deviceId} onChange={(e) => set({ deviceId: e.target.value })} disabled={recording}>
                <option value="">The Mac's default input</option>
                {inputs.map((input) => <option key={input.id} value={input.id}>{input.label}</option>)}
              </select>
              <button type="button" onClick={findInputs} disabled={recording}>Find inputs</button>
            </span>
          </label>
          <label>Microphones
            <select value={settings.mode} onChange={(e) => set({ mode: e.target.value })} disabled={recording}>
              <option value="split">Two: input 1 and input 2 are two people</option>
              <option value="mix">One (or everyone on one track)</option>
            </select>
          </label>
          <label>{settings.mode === "mix" ? "Speaker" : "Input 1 is"}
            <input value={settings.names[0]} onChange={(e) => set({ names: [e.target.value, settings.names[1]] })} />
          </label>
          {settings.mode === "split" && <label>Input 2 is
            <input value={settings.names[1]} onChange={(e) => set({ names: [settings.names[0], e.target.value] })} />
          </label>}
          <label>Transcription
            <select value={settings.model} onChange={(e) => set({ model: e.target.value })}>
              {transcriptionModels.map(([id, label]) => <option key={id} value={id} disabled={id === "local-whisper" && keys && !keys.local}>{label}</option>)}
            </select>
          </label>
          <label>Language
            <input value={settings.language} onChange={(e) => set({ language: e.target.value })} placeholder="en (blank: detect)" />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={settings.auto} onChange={(e) => set({ auto: e.target.checked })} />
            Automatic speech detection: each microphone learns its own background level, and speech is anything well above it (the line on each meter)
          </label>
          {!settings.auto && <label>Speech threshold: {thresholdDb} dB
            <input type="range" min="-60" max="-15" value={thresholdDb} onChange={(e) => set({ threshold: 10 ** (Number(e.target.value) / 20) })} />
            <small>The line on the meters. Talking should go past it, and the room's hum shouldn't.</small>
          </label>}
          {settings.mode === "split" && <label className={styles.check}>
            <input type="checkbox" checked={settings.bleedGate} onChange={(e) => set({ bleedGate: e.target.checked })} />
            Bleed gate: only the louder microphone counts as speaking, so a voice picked up by both isn't transcribed twice
          </label>}
        </div>
      </details>

      <details className={styles.step} open={!recording && !lines.length}>
        <summary><span className={styles.stepNumber}>3</span><span className={styles.stepTitle}><strong>Context setup</strong><small>What the AI reads and is told: your documents, the pre-interview notes, the prompts, and every request as it goes out</small></span><span className={styles.stepCaret} aria-hidden="true" /></summary>
        <div className={styles.sent}>
          <div className={styles.sentWide}>
            <h3>What the AI reads</h3>
            <div className={styles.fields}>
          <label className={styles.wide}>Context
            <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple onChange={(e) => { addDocuments(e.target.files); e.target.value = ""; }} />
            <small>Upload as many Markdown or text files as you like: the pre-interview transcript, the beat sheet you made from it, the guest's context repository README, your own notes. The AI reads all of them, with the notes below, for the starter question, every highlighted question, research, and the beat sheet.</small>
            {documents.length > 0 && (
              <ul className={styles.documents}>
                {documents.map((doc) => (
                  <li key={doc.name}><span>{doc.name}</span><small>{Math.max(1, Math.round(doc.text.length / 1000))} K</small><button type="button" onClick={() => removeDocument(doc.name)} aria-label={`Remove ${doc.name}`}>Remove</button></li>
                ))}
              </ul>
            )}
          </label>
          {settings.kind === "pre-interview"
            ? <p className={styles.fieldNote}>There are no pre-interview notes yet: this recording makes them. When you're done, <strong>Use as pre-interview notes</strong> above the transcript keeps the transcript here for the practice run and the live interview.</p>
            : <label className={styles.wide}>Pre-interview notes
              <textarea rows={5} value={context} onChange={(e) => setContext(e.target.value)} placeholder="What the producer learned before the interview. Paste notes or a transcript here, or record the pre-interview on this machine and use its transcript." />
              <small>The AI reads these for the starter question and every follow-up.</small>
            </label>}
            </div>
          </div>
          <div>
            <h3>Transcription</h3>
            <p>Each time someone pauses, what they just said goes to {settings.model === "local-whisper" ? "your local Whisper server" : `${transcriptionModels.find(([id]) => id === settings.model)?.[1] || settings.model} through OpenRouter`} as this request. The hint helps it spell names and terms; it isn't an instruction, and the model only transcribes.</p>
            <label className={styles.block}>Hint
              <input value={settings.hints} onChange={(e) => set({ hints: e.target.value })} placeholder={defaultHints(settings.names)} />
            </label>
            <pre>{JSON.stringify(sentForTranscription, null, 2)}</pre>
          </div>
          <div>
            <h3>Questions and research</h3>
            <p>Starter question, Beat sheet, and Research each send one request: your instructions as the system prompt, then the documents and notes above, the transcript so far, and the ask. Research adds OpenRouter's web search (the Exa engine, which cites its sources) and costs a little more per call. A Question highlight sends two requests at once: the framed one, and an unframed one that gets none of your instructions, notes, or transcript, only the passage, the lines around it, and your note. Its single question is tagged <em>Unframed</em>, so you can compare. The prompts live in <code>app/machine/prompts.mjs</code>.</p>
            <label className={styles.block}>Model
              <select value={settings.suggestModel} onChange={(e) => set({ suggestModel: e.target.value })}>
                {suggestModels.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className={styles.block}>Instructions (the system prompt)
              <textarea rows={12} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </label>
            {instructions !== defaultInstructions && <button type="button" className={styles.small} onClick={() => setInstructions(defaultInstructions)}>Reset instructions</button>}
            <p>The asks, one of which ends each message:</p>
            <pre>{Object.entries(asks).map(([mode, ask]) => `${labels[mode]}:\n${ask}`).join("\n\n")}</pre>
            <p>A Question request, with the parts that come from the session in braces:</p>
            <pre>{JSON.stringify(sentForQuestions, null, 2)}</pre>
            <p>The unframed request that goes out alongside it:</p>
            <pre>{JSON.stringify(sentUnframed, null, 2)}</pre>
          </div>
        </div>
      </details>

      <section className={styles.deck} aria-label="Recording">
        <p className={styles.stepLabel}><span className={styles.stepNumber}>4</span> Record {kinds.find(([key]) => key === settings.kind)?.[1].toLowerCase()}</p>
        <div className={styles.transport}>
          <button type="button" className={recording ? styles.stop : styles.record} onClick={recording ? stop : start}>
            <span className={styles.dot} aria-hidden="true" />{recording ? "Stop" : "Record"}
          </button>
          <span className={styles.clock} aria-live="off">{clock(elapsed)}</span>
          {recording && <span className={styles.onAir}>On air{channels === 1 && settings.mode === "split" ? " · this input is mono, so everything is the first name" : ""}</span>}
        </div>
        <div className={styles.meters}>
          {names.map((name, c) => {
            const db = settings.mode === "mix" ? Math.max(...levels) : levels[c];
            return (
              <div key={c} className={styles.meter}>
                <span className={styles.meterName}>{settings.mode === "mix" ? "Level" : `Input ${c + 1} · ${name}`}</span>
                <span className={styles.meterTrack}>
                  <span className={styles.meterFill} style={{ width: `${((db + 60) / 60) * 100}%`, background: db > -6 ? "var(--error)" : db > -20 ? "var(--accent)" : "var(--ok)" }} />
                  <span className={styles.meterMark} style={{ left: `${(((thresholds[c] ?? thresholdDb) + 60) / 60) * 100}%` }} title="Speech threshold" />
                </span>
              </div>
            );
          })}
        </div>
        {keys && !keys.openrouter && settings.model !== "local-whisper" && <p className={styles.warn}>There's no OPENROUTER_API_KEY in the repo's <code>.env</code>, so nothing will be transcribed. Copy <code>.env.example</code> to <code>.env</code> and add the key.</p>}
        {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => setError("")}>Dismiss</button></p>}
      </section>

      <div className={styles.columns}>
        <section className={styles.transcript} aria-label="Transcript">
          <header className={styles.panelHead}>
            <h2>Transcript {aiSourced > 0 && <span className={styles.tally} title="Lines that came from the AI">{aiSourced} AI-sourced</span>}</h2>
            <span className={styles.actions}>
              {settings.kind === "pre-interview" && finished.length > 0 && (
                context === transcriptText(lines, settings.names)
                  ? <span className={styles.saved}>Saved as pre-interview notes ✓</span>
                  : <button type="button" className={styles.accentButton} onClick={() => setContext(transcriptText(lines, settings.names))}>Use as pre-interview notes</button>
              )}
              <button type="button" onClick={exportTranscript} disabled={!finished.length}>Download .md</button>
              <button type="button" onClick={exportBeatSheet} disabled={!!busy || (!finished.length && !context.trim() && !documents.length)} title="A one-page producer's brief for the host, written by the AI from the notes and this transcript">{busy === "beatsheet" ? "Writing…" : "Beat sheet .md"}</button>
              {audio && <button type="button" onClick={() => download(`${settings.kind}-${new Date().toISOString().slice(0, 10)}.${audio.type.includes("mp4") ? "m4a" : "webm"}`, audio)}>Download recording</button>}
              <button type="button" onClick={clearSession} disabled={recording || (!lines.length && !suggestions.length)}>Clear</button>
            </span>
          </header>
          {!lines.length && <p className={styles.empty}>Press Record and start talking. Each thing someone says appears here a few seconds after they pause. Click any line to fix it. Highlight any passage to ask the AI for a follow-up question about it, or to check a claim in it.</p>}
          <ol className={styles.lines} ref={transcriptRef}>
            {lines.map((line) => (
              <li key={line.id} className={`${line.channel === 1 ? styles.lineB : styles.lineA}${line.source === "ai" ? ` ${styles.lineAi}` : ""}`}>
                <span className={styles.who}>
                  {settings.names[line.channel]} <time>{clock(line.start)}</time>
                  {line.source === "ai" && <span className={styles.badge}>{sourceLabel(line)}</span>}
                  {!line.pending && <button type="button" className={styles.sourceToggle} onClick={() => toggleSource(line.id)} title={line.source === "ai" ? "This came from the people in the room, not the AI" : "This came from the AI"}>{line.source === "ai" ? "mark organic" : "mark AI"}</button>}
                </span>
                {line.pending ? <span className={styles.pending}>…</span> : <span contentEditable suppressContentEditableWarning onBlur={(e) => editLine(line.id, e.currentTarget.textContent)}>{line.text}</span>}
              </li>
            ))}
          </ol>
          {pick && (
            <form data-popover className={styles.popover} style={{ top: pick.top, left: pick.left }} onSubmit={(e) => { e.preventDefault(); ask(pickMode, pick.text, note); }}>
              <span className={styles.popoverQuote}>“{short(pick.text, 100)}”</span>
              <span className={styles.popoverChoice} role="radiogroup" aria-label="What to do with it">
                <button type="button" role="radio" aria-checked={pickMode === "question"} className={pickMode === "question" ? styles.choiceOn : styles.choice} onClick={() => setPickMode("question")}>Question</button>
                <button type="button" role="radio" aria-checked={pickMode === "research"} className={pickMode === "research" ? styles.choiceOn : styles.choice} onClick={() => setPickMode("research")}>Research</button>
              </span>
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={pickMode === "research" ? "Optional: what to check, or what you want to know" : "Optional: what kind of question"} aria-label="A note for the AI" />
              <span className={styles.popoverButtons}>
                <button type="submit" className={styles.popoverPrimary} disabled={!!busy}>{busy ? (pickMode === "research" ? "Looking…" : "Thinking…") : pickMode === "research" ? "Research this" : "Ask for questions"}</button>
                <button type="button" className={styles.popoverClose} onClick={() => setPick(null)} aria-label="Close">×</button>
              </span>
            </form>
          )}
        </section>

        <section className={styles.producer} aria-label="Producer">
          <header className={styles.panelHead}><h2>Producer</h2></header>
          {!context.trim() && !documents.length && settings.kind !== "pre-interview" && <p className={styles.hint}>No pre-interview notes or documents yet. The AI works better with them: add them under Context setup, or record the pre-interview first.</p>}
          <div className={styles.suggestBar}>
            <button type="button" className={styles.primary} onClick={() => ask("starter")} disabled={!!busy}>{busy === "starter" ? "Thinking…" : "Starter question"}</button>
            <span className={styles.hint}>Then highlight any part of the transcript for a follow-up question, or to research a claim.</span>
          </div>
          <ul className={styles.suggestions}>
            {suggestions.map((item) => (
              <li key={item.id} className={item.kind === "research" ? styles.research : undefined}>
                {item.excerpt && <span className={styles.from}>{item.kind === "research" ? "Checking" : "About"}: “{short(item.excerpt)}”{item.note ? ` · ${item.note}` : ""}</span>}
                <button type="button" className={item.kind === "research" ? styles.finding : styles.question} onClick={() => show(item)} title="Show it big, for the host">{item.text}</button>
                {item.sources?.length > 0 && (
                  <details className={styles.sourcesFold}>
                    <summary>Sources · {item.sources.length}</summary>
                    <span className={styles.sources}>{item.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</span>
                  </details>
                )}
                <span className={styles.marks}>
                  <span className={styles.kindTag}>{labels[item.kind] || "Question"}</span>
                  <button type="button" onClick={() => use(item)} title="Log it in the transcript as AI-sourced">{item.kind === "research" ? "Used" : "Asked"}</button>
                  <button type="button" onClick={() => dismiss(item.id)}>{item.kind === "research" ? "Dismiss" : "Skip"}</button>
                </span>
              </li>
            ))}
          </ul>

        </section>
      </div>

      {card && (
        <button type="button" className={styles.card} onClick={() => setCard("")} aria-label="Close">
          <span className={card.length > 160 ? styles.cardLong : undefined}>{card}</span>
          <small>Click anywhere to close</small>
        </button>
      )}
    </div>
  );
}
