"use client";

import { useEffect, useRef, useState } from "react";
import { askPermission, base64, listInputs, Recorder } from "./recorder.mjs";
import styles from "./machine.module.css";

// The recording and interviewing machine. It records from an audio interface (or any microphone), transcribes each
// utterance as it ends, and gives the producer follow-up questions from the pre-interview and the transcript so far.
// Everything on the page is kept in this browser (localStorage), so a reload doesn't lose the session.

const kinds = [
  ["pre-interview", "Pre-interview"],
  ["practice", "Practice run"],
  ["interview", "Live interview"],
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

const defaultInstructions = `You help the producer of a live podcast interview. A student (the guest) is being interviewed by another student (the host) about a creative project: the choices they made, how they used AI, and what they added as a person.

Read the pre-interview notes and the live transcript so far. Suggest three short follow-up questions the host could ask next:
- Prefer following up on something the guest just said.
- Ask for specific moments and examples rather than general claims ("Show me the moment that decision happened").
- If something important from the pre-interview hasn't come up yet, one question can bring it in.
- Questions about AI should get at judgment: what they threw out, how they knew it wasn't good enough, what a beginner would have done differently.

One question per line, no numbering, no preamble.`;

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

function transcriptText(lines, names) {
  return lines.filter((line) => line.text).map((line) => `${names[line.channel]} (${clock(line.start)}): ${line.text}`).join("\n");
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
    autoSuggest: false,
  });
  const [lines, setLines] = useState([]);
  const [context, setContext] = useState("");
  const [instructions, setInstructions] = useState(defaultInstructions);
  const [suggestions, setSuggestions] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [card, setCard] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState([-60, -60]);
  const [thresholds, setThresholds] = useState([]);
  const [channels, setChannels] = useState(0);
  const [keys, setKeys] = useState(null);
  const [error, setError] = useState("");
  const [audio, setAudio] = useState(null);

  const recorder = useRef(null);
  const started = useRef(0);
  const lastSuggest = useRef({ at: 0, count: 0 });
  const latest = useRef({});
  latest.current = { settings, lines, context, instructions, suggesting };

  // Restore the last session from this browser, then keep saving it.
  useEffect(() => {
    setSettings((current) => ({ ...current, ...load(store("settings"), {}) }));
    setLines(load(store("lines"), []).filter((line) => !line.pending));
    setContext(load(store("context"), ""));
    setInstructions(load(store("instructions"), defaultInstructions));
    setSuggestions(load(store("suggestions"), []));
    setReady(true);
    fetch(`${apiBase}/transcribe`).then((r) => r.json()).then(setKeys).catch(() => setKeys({ openrouter: false, local: false }));
    listInputs().then(setInputs).catch(() => {});
  }, []);
  useEffect(() => { if (ready) save(store("settings"), settings); }, [ready, settings]);
  useEffect(() => { if (ready) save(store("lines"), lines); }, [ready, lines]);
  useEffect(() => { if (ready) save(store("context"), context); }, [ready, context]);
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

  const set = (patch) => setSettings((current) => ({ ...current, ...patch }));

  async function findInputs() {
    try {
      await askPermission();
      setInputs(await listInputs());
    } catch (e) {
      setError(`Couldn't open the microphone: ${e.message}`);
    }
  }

  async function transcribe(segment, offset) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const line = { id, channel: settings.mode === "mix" ? 0 : segment.channel, start: offset + segment.start, text: "", pending: true };
    setLines((current) => [...current, line].sort((a, b) => a.start - b.start));
    try {
      const { model, language } = latest.current.settings;
      const response = await fetch(`${apiBase}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, language, format: "wav", data: base64(segment.wav) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Transcription failed (${response.status}).`);
      const text = body.text.trim();
      setLines((current) => text ? current.map((item) => item.id === id ? { ...item, text, pending: false } : item) : current.filter((item) => item.id !== id));
      if (text) maybeSuggest();
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

  async function suggest() {
    const { settings, lines, context, instructions } = latest.current;
    setSuggesting(true);
    lastSuggest.current = { at: Date.now(), count: lines.filter((line) => line.text).length };
    try {
      const response = await fetch(`${apiBase}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: settings.suggestModel, instructions, context, transcript: transcriptText(lines, settings.names) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Suggestions failed (${response.status}).`);
      const fresh = body.text.split("\n").map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean)
        .map((text) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, state: "new", at: Date.now() }));
      setSuggestions((current) => [...fresh, ...current].slice(0, 40));
    } catch (e) {
      setError(e.message);
    } finally {
      setSuggesting(false);
    }
  }

  // With auto on: new suggestions after at least two new lines and 20 seconds since the last ones.
  function maybeSuggest() {
    setTimeout(() => {
      const { settings, lines, suggesting } = latest.current;
      if (!settings.autoSuggest || suggesting) return;
      const count = lines.filter((line) => line.text).length;
      if (count - lastSuggest.current.count >= 2 && Date.now() - lastSuggest.current.at > 20000) suggest();
    }, 0);
  }

  function mark(id, state) {
    setSuggestions((current) => current.map((item) => item.id === id ? { ...item, state } : item));
  }

  function editLine(id, text) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, text } : line));
  }

  function exportTranscript() {
    const kind = kinds.find(([key]) => key === settings.kind)?.[1] || "Session";
    const date = new Date().toISOString().slice(0, 10);
    const body = lines.filter((line) => line.text).map((line) => `**${settings.names[line.channel]}** (${clock(line.start)}): ${line.text}`).join("\n\n");
    const md = `---\ntitle: ${kind}, ${date}\nkind: ${settings.kind}\ntranscribed_by: ${settings.model}\n---\n\n${body}\n`;
    download(`${settings.kind}-${date}.md`, new Blob([md], { type: "text/markdown" }));
  }

  function clearSession() {
    if (!confirm("Clear the transcript and suggestions? Download them first if you want to keep them.")) return;
    setLines([]);
    setSuggestions([]);
    setAudio(null);
    setElapsed(0);
  }

  const names = settings.mode === "mix" ? [settings.names[0]] : settings.names;
  const finished = lines.filter((line) => line.text);
  const thresholdDb = Math.round(20 * Math.log10(settings.threshold));

  return (
    <div className={styles.machine}>
      <section className={styles.deck} aria-label="Recording">
        <div className={styles.kinds} role="group" aria-label="What you're recording">
          {kinds.map(([key, label]) => (
            <button key={key} type="button" className={settings.kind === key ? styles.kindOn : styles.kind} onClick={() => set({ kind: key })} aria-pressed={settings.kind === key}>{label}</button>
          ))}
        </div>
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

      <details className={styles.setup} open={!recording && !lines.length}>
        <summary>Setup</summary>
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

      <div className={styles.columns}>
        <section className={styles.transcript} aria-label="Transcript">
          <header className={styles.panelHead}>
            <h2>Transcript</h2>
            <span className={styles.actions}>
              <button type="button" onClick={exportTranscript} disabled={!finished.length}>Download .md</button>
              {audio && <button type="button" onClick={() => download(`${settings.kind}-${new Date().toISOString().slice(0, 10)}.${audio.type.includes("mp4") ? "m4a" : "webm"}`, audio)}>Download recording</button>}
              <button type="button" onClick={clearSession} disabled={recording || (!lines.length && !suggestions.length)}>Clear</button>
            </span>
          </header>
          {!lines.length && <p className={styles.empty}>Press Record and start talking. Each thing someone says appears here a few seconds after they pause. Click any line to fix it.</p>}
          <ol className={styles.lines}>
            {lines.map((line) => (
              <li key={line.id} className={line.channel === 1 ? styles.lineB : styles.lineA}>
                <span className={styles.who}>{settings.names[line.channel]} <time>{clock(line.start)}</time></span>
                {line.pending ? <span className={styles.pending}>…</span> : <span contentEditable suppressContentEditableWarning onBlur={(e) => editLine(line.id, e.currentTarget.textContent)}>{line.text}</span>}
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.producer} aria-label="Producer">
          <header className={styles.panelHead}><h2>Producer</h2></header>
          <label className={styles.block}>Pre-interview notes
            <textarea rows={5} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Paste the pre-interview transcript or notes here, or record the pre-interview on this machine and use the button below." />
          </label>
          <button type="button" className={styles.small} onClick={() => setContext(transcriptText(lines, settings.names))} disabled={!finished.length}>Use this transcript as the pre-interview</button>

          <div className={styles.suggestBar}>
            <button type="button" className={styles.primary} onClick={suggest} disabled={suggesting}>{suggesting ? "Thinking…" : "Suggest follow-ups"}</button>
            <label className={styles.check}><input type="checkbox" checked={settings.autoSuggest} onChange={(e) => set({ autoSuggest: e.target.checked })} /> Automatically while recording</label>
          </div>
          <ul className={styles.suggestions}>
            {suggestions.map((item) => (
              <li key={item.id} className={item.state === "asked" ? styles.asked : item.state === "skipped" ? styles.skipped : undefined}>
                <button type="button" className={styles.question} onClick={() => setCard(item.text)} title="Show it big, for the host">{item.text}</button>
                <span className={styles.marks}>
                  <button type="button" onClick={() => mark(item.id, item.state === "asked" ? "new" : "asked")}>{item.state === "asked" ? "Asked ✓" : "Asked"}</button>
                  <button type="button" onClick={() => mark(item.id, item.state === "skipped" ? "new" : "skipped")}>Skip</button>
                </span>
              </li>
            ))}
          </ul>

          <details className={styles.instructions}>
            <summary>What the AI is told</summary>
            <label className={styles.block}>Model
              <select value={settings.suggestModel} onChange={(e) => set({ suggestModel: e.target.value })}>
                {suggestModels.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className={styles.block}>Instructions
              <textarea rows={12} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </label>
            <button type="button" className={styles.small} onClick={() => setInstructions(defaultInstructions)}>Reset instructions</button>
          </details>
        </section>
      </div>

      {card && (
        <button type="button" className={styles.card} onClick={() => setCard("")} aria-label="Close">
          <span>{card}</span>
          <small>Click anywhere to close</small>
        </button>
      )}
    </div>
  );
}
