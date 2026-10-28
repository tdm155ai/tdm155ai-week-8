"use client";

import { useEffect, useRef, useState } from "react";
import { askPermission, base64, listInputs } from "../recorder.mjs";
import { MultiRecorder } from "./multi-recorder.mjs";
import styles from "../machine.module.css";

// The multi-mic interview machine: the two-mic machine (../Machine.jsx) for 3 to 8 microphones, one speaker per
// microphone. Transcription and follow-ups use the same server routes as the two-mic machine (/machine/api).

// An interface can report more inputs than it has microphone sockets (an 18i20 reports 18: eight mic/line inputs
// plus digital ones that are usually empty), so only the first `count` inputs are shown and used.
const colors = ["var(--accent)", "var(--ok)", "#7fb3ff", "#e8a6ff", "#ffd36b", "#6be0d1", "#ff9f6b", "#c7c7c7"];

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

const defaultInstructions = `You help the producer of a live podcast interview with more than one guest. Students (the guests) are being interviewed by another student (the host) about a creative project they made together, or about their separate projects: the choices they made, how they used AI, and what they added as people.

Read the pre-interview notes and the live transcript so far. Suggest three short follow-up questions the host could ask next:
- Prefer following up on something a guest just said, and name who the question is for.
- Ask for specific moments and examples rather than general claims ("Show me the moment that decision happened").
- With several guests, bring in someone who hasn't said much, or ask one guest to respond to another.
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
  return lines.filter((line) => line.text).map((line) => `${names[line.channel] || `Mic ${line.channel + 1}`} (${clock(line.start)}): ${line.text}`).join("\n");
}

export default function MultiMachine({ apiBase, captureBase, storageKey }) {
  const store = (name) => `${storageKey}:${name}`;
  const [ready, setReady] = useState(false);
  const [browserInputs, setBrowserInputs] = useState([]);
  const [nativeInputs, setNativeInputs] = useState(null);
  const [settings, setSettings] = useState({
    source: "native",
    nativeDevice: "",
    browserDevice: "",
    count: 4,
    names: [],
    enabled: [],
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
  const [levels, setLevels] = useState([]);
  const [thresholds, setThresholds] = useState([]);
  const [channels, setChannels] = useState(0);
  const [savedFile, setSavedFile] = useState("");
  const [error, setError] = useState("");
  const [audio, setAudio] = useState(null);

  const recorder = useRef(null);
  const started = useRef(0);
  const lastSuggest = useRef({ at: 0, count: 0 });
  const latest = useRef({});
  latest.current = { settings, lines, context, instructions, suggesting };

  useEffect(() => {
    setSettings((current) => ({ ...current, ...load(store("settings"), {}) }));
    setLines(load(store("lines"), []).filter((line) => !line.pending));
    setContext(load(store("context"), ""));
    setInstructions(load(store("instructions"), defaultInstructions));
    setSuggestions(load(store("suggestions"), []));
    setReady(true);
    listInputs().then(setBrowserInputs).catch(() => {});
    findNativeInputs();
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

  useEffect(() => {
    if (recorder.current) Object.assign(recorder.current.settings, { threshold: settings.threshold, auto: settings.auto, bleedGate: settings.bleedGate, enabled: used });
  }, [settings.threshold, settings.auto, settings.bleedGate, settings.enabled, settings.count]);

  const set = (patch) => setSettings((current) => ({ ...current, ...patch }));
  const names = Array.from({ length: 32 }, (_, c) => settings.names[c] || (c === 0 ? "Host" : `Guest ${c}`));
  const used = Array.from({ length: 32 }, (_, c) => c < settings.count && settings.enabled[c] !== false);
  const setName = (c, name) => { const next = [...names]; next[c] = name; set({ names: next }); };
  const setEnabled = (c, on) => { const next = Array.from({ length: 32 }, (_, i) => settings.enabled[i] !== false); next[c] = on; set({ enabled: next }); };

  async function findNativeInputs() {
    try {
      const body = await (await fetch(`${captureBase}/capture`)).json();
      if (body.error) throw new Error(body.error);
      setNativeInputs(body.devices);
      // Pick the first Focusrite-looking input if none is chosen yet.
      setSettings((current) => current.nativeDevice !== "" ? current : { ...current, nativeDevice: String((body.devices.find((d) => /scarlett|focusrite|clarett/i.test(d.name)) || body.devices[0] || { index: "" }).index) });
    } catch (e) {
      setNativeInputs([]);
      setError(e.message);
    }
  }

  async function findBrowserInputs() {
    try {
      await askPermission();
      setBrowserInputs(await listInputs());
    } catch (e) {
      setError(`Couldn't open the microphone: ${e.message}`);
    }
  }

  async function transcribe(segment, offset) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const line = { id, channel: segment.channel, start: offset + segment.start, text: "", pending: true };
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
    setSavedFile("");
    const offset = lines.length ? Math.max(...lines.map((line) => line.start)) + 1 : 0;
    const engine = new MultiRecorder({
      onLevels: (dbs, marks) => { setLevels(dbs); setThresholds(marks); },
      onSegment: (segment) => transcribe(segment, offset),
      onEnd: (message) => { setError(message); stop(); },
    });
    const options = { threshold: settings.threshold, auto: settings.auto, bleedGate: settings.bleedGate, enabled: used };
    try {
      const info = settings.source === "native"
        ? await engine.startNative(captureBase, settings.nativeDevice, options)
        : await engine.startBrowser(settings.browserDevice, options);
      recorder.current = engine;
      setChannels(info.channels);
      setSavedFile(info.file || "");
      if (info.source === "browser" && info.channels <= 2) setError(`The browser only gave this page ${info.channels} channel${info.channels === 1 ? "" : "s"}. For more microphones, stop and switch Capture to "Native (ffmpeg)".`);
      started.current = performance.now() - offset * 1000;
      setElapsed(offset);
      setRecording(true);
    } catch (e) {
      setError(`Couldn't start recording: ${e.message}`);
    }
  }

  async function stop() {
    const engine = recorder.current;
    recorder.current = null;
    setRecording(false);
    setLevels([]);
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
        body: JSON.stringify({ model: settings.suggestModel, instructions, context, transcript: transcriptText(lines, latest.current.names) }),
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
    const date = new Date().toISOString().slice(0, 10);
    const body = lines.filter((line) => line.text).map((line) => `**${names[line.channel]}** (${clock(line.start)}): ${line.text}`).join("\n\n");
    const md = `---\ntitle: Multi-mic interview, ${date}\ntranscribed_by: ${settings.model}\n---\n\n${body}\n`;
    download(`multi-interview-${date}.md`, new Blob([md], { type: "text/markdown" }));
  }

  function clearSession() {
    if (!confirm("Clear the transcript and suggestions? Download them first if you want to keep them.")) return;
    setLines([]);
    setSuggestions([]);
    setAudio(null);
    setElapsed(0);
  }

  const shown = channels ? Math.min(settings.count, channels) : settings.count;
  latest.current.names = names; // for suggest(), which reads the latest values
  const finished = lines.filter((line) => line.text);
  const thresholdDb = Math.round(20 * Math.log10(settings.threshold));

  return (
    <div className={styles.machine}>
      <section className={styles.deck} aria-label="Recording">
        <div className={styles.transport}>
          <button type="button" className={recording ? styles.stop : styles.record} onClick={recording ? stop : start}>
            <span className={styles.dot} aria-hidden="true" />{recording ? "Stop" : "Record"}
          </button>
          <span className={styles.clock}>{clock(elapsed)}</span>
          {recording && <span className={styles.onAir}>On air · {channels} channel{channels === 1 ? "" : "s"}</span>}
        </div>
        <div className={styles.meters}>
          {Array.from({ length: shown }, (_, c) => {
            const db = levels[c] ?? -60;
            const on = used[c];
            return (
              <div key={c} className={styles.meter} style={{ opacity: on ? 1 : .35 }}>
                <span className={styles.meterName}>
                  <input type="checkbox" checked={on} onChange={(e) => setEnabled(c, e.target.checked)} aria-label={`Use input ${c + 1}`} style={{ accentColor: colors[c], marginRight: 8 }} />
                  {`Input ${c + 1} · ${names[c]}`}
                </span>
                <span className={styles.meterTrack}>
                  <span className={styles.meterFill} style={{ width: `${((db + 60) / 60) * 100}%`, background: db > -6 ? "var(--error)" : colors[c] }} />
                  <span className={styles.meterMark} style={{ left: `${(((thresholds[c] ?? thresholdDb) + 60) / 60) * 100}%` }} title="Speech threshold" />
                </span>
              </div>
            );
          })}
        </div>
        {savedFile && <p className={styles.warn}>{recording ? "Recording" : "Saved"} the whole session to <code>{savedFile}</code> (all channels, full quality).</p>}
        {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => setError("")}>Dismiss</button></p>}
      </section>

      <details className={styles.setup} open={!recording && !lines.length}>
        <summary>Setup</summary>
        <div className={styles.fields}>
          <label>Capture
            <select value={settings.source} onChange={(e) => set({ source: e.target.value })} disabled={recording}>
              <option value="native">Native (ffmpeg on this Mac): every channel</option>
              <option value="browser">Browser: usually only 2 channels</option>
            </select>
          </label>
          {settings.source === "native" ? (
            <label>Input
              <span className={styles.row}>
                <select value={settings.nativeDevice} onChange={(e) => set({ nativeDevice: e.target.value })} disabled={recording}>
                  {(nativeInputs || []).map((d) => <option key={d.index} value={String(d.index)}>{d.name}</option>)}
                </select>
                <button type="button" onClick={findNativeInputs} disabled={recording}>Refresh</button>
              </span>
            </label>
          ) : (
            <label>Input
              <span className={styles.row}>
                <select value={settings.browserDevice} onChange={(e) => set({ browserDevice: e.target.value })} disabled={recording}>
                  <option value="">The Mac's default input</option>
                  {browserInputs.map((input) => <option key={input.id} value={input.id}>{input.label}</option>)}
                </select>
                <button type="button" onClick={findBrowserInputs} disabled={recording}>Find inputs</button>
              </span>
            </label>
          )}
          <label>Microphones in use
            <input type="number" min="1" max={channels || 18} value={settings.count} onChange={(e) => set({ count: Math.max(1, Math.min(channels || 18, Number(e.target.value) || 1)) })} />
            <small>Inputs 1 to {settings.count}.{channels ? ` Your interface reports ${channels} inputs; the rest are ignored.` : ""}</small>
          </label>
          {Array.from({ length: shown }, (_, c) => (
            <label key={c}>Input {c + 1} is
              <input value={names[c]} onChange={(e) => setName(c, e.target.value)} />
            </label>
          ))}
          <label>Transcription
            <select value={settings.model} onChange={(e) => set({ model: e.target.value })}>
              {transcriptionModels.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
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
          <label className={styles.check}>
            <input type="checkbox" checked={settings.bleedGate} onChange={(e) => set({ bleedGate: e.target.checked })} />
            Bleed gate: only the loudest microphone counts as speaking, so a voice picked up by the other microphones isn't transcribed twice
          </label>
        </div>
      </details>

      <div className={styles.columns}>
        <section className={styles.transcript} aria-label="Transcript">
          <header className={styles.panelHead}>
            <h2>Transcript</h2>
            <span className={styles.actions}>
              <button type="button" onClick={exportTranscript} disabled={!finished.length}>Download .md</button>
              {audio && <button type="button" onClick={() => download(`multi-interview-${new Date().toISOString().slice(0, 10)}.webm`, audio)}>Download recording</button>}
              {savedFile && !recording && <>
                <a className={styles.linkButton} href={`${captureBase}/capture?file=${encodeURIComponent(savedFile.split("/").pop())}&mix=${used.map((on, c) => on ? c : null).filter((c) => c !== null && c < (channels || 0)).join(",")}`} download>Download mix (MP3)</a>
                <a className={styles.linkButton} href={`${captureBase}/capture?file=${encodeURIComponent(savedFile.split("/").pop())}`} download>All channels (WAV)</a>
              </>}
              <button type="button" onClick={clearSession} disabled={recording || (!lines.length && !suggestions.length)}>Clear</button>
            </span>
          </header>
          {!lines.length && <p className={styles.empty}>Name each input, untick the ones nobody is using, and press Record. Each thing someone says appears here a few seconds after they pause.</p>}
          <ol className={styles.lines}>
            {lines.map((line) => (
              <li key={line.id} className={styles.lineA} style={{ borderLeftColor: colors[line.channel] }}>
                <span className={styles.who}>{names[line.channel]} <time>{clock(line.start)}</time></span>
                {line.pending ? <span className={styles.pending}>…</span> : <span contentEditable suppressContentEditableWarning onBlur={(e) => editLine(line.id, e.currentTarget.textContent)}>{line.text}</span>}
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.producer} aria-label="Producer">
          <header className={styles.panelHead}><h2>Producer</h2></header>
          <label className={styles.block}>Pre-interview notes
            <textarea rows={5} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Paste the pre-interview transcript or notes here." />
          </label>
          <button type="button" className={styles.small} onClick={() => setContext(transcriptText(lines, names))} disabled={!finished.length}>Use this transcript as the pre-interview</button>
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
