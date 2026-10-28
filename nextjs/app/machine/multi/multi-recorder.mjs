// The multi-mic engine: up to 8 microphones, each one a speaker, cut into utterances with the same Segmenter as the
// two-mic machine (../recorder.mjs). Two ways in:
// - "browser": the page opens the interface itself. Chrome usually stops at 2 channels, so this only helps if your
//   browser actually delivers more (the page shows how many it got).
// - "native": the local server captures the interface with ffmpeg (api/capture) and streams the raw sound to the page,
//   all channels, 16 kHz. It also saves the whole session as one multichannel WAV in the repo's _media/ folder.
//
// The bleed gate is the same idea as with two microphones: a microphone only counts as speaking when it's clearly
// louder than every other one.

import { rms, Segmenter, toDb } from "../recorder.mjs";

const workletSource = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buffers = null; this.filled = 0; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    if (!this.buffers || this.buffers.length !== input.length) {
      this.buffers = input.map(() => new Float32Array(2048));
      this.filled = 0;
    }
    for (let c = 0; c < input.length; c++) this.buffers[c].set(input[c], this.filled);
    this.filled += input[0].length;
    if (this.filled >= 2048) {
      this.port.postMessage(this.buffers.map((b) => b.slice(0, this.filled)));
      this.filled = 0;
    }
    return true;
  }
}
registerProcessor("tap-multi", Tap);
`;

export class MultiRecorder {
  // onLevels([dB, …], [threshold dB, …]) about 20 times a second; onSegment({ channel, start, seconds, wav }) for each utterance;
  // onEnd(message) if the native capture stops on its own.
  constructor({ onLevels, onSegment, onEnd }) {
    this.onLevels = onLevels;
    this.onSegment = onSegment;
    this.onEnd = onEnd;
    // enabled: which channels are people (the rest are ignored).
    this.settings = { threshold: 0.02, auto: true, bleedGate: true, pause: 0.8, longest: 15, shortest: 0.4, enabled: [] };
  }

  setup(channels, rate) {
    this.channels = channels;
    this.floors = [];
    this.active = [];
    this.samples = 0;
    this.lastLevels = 0;
    this.segmenters = Array.from({ length: channels }, (_, channel) => new Segmenter(rate, (segment) => this.onSegment({ channel, ...segment }), this.settings));
  }

  async startBrowser(deviceId, settings = {}) {
    Object.assign(this.settings, settings);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: 8 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const channels = this.stream.getAudioTracks()[0].getSettings().channelCount || 1;
    this.context = new AudioContext();
    const url = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
    await this.context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = this.context.createMediaStreamSource(this.stream);
    const tap = new AudioWorkletNode(this.context, "tap-multi", { channelCount: channels, channelCountMode: "explicit", channelInterpretation: "discrete" });
    const mute = this.context.createGain();
    mute.gain.value = 0;
    source.connect(tap).connect(mute).connect(this.context.destination);
    this.setup(channels, this.context.sampleRate);
    tap.port.onmessage = ({ data }) => this.block(data);
    this.chunks = [];
    this.media = new MediaRecorder(this.stream);
    this.media.ondataavailable = (event) => event.data.size && this.chunks.push(event.data);
    this.media.start(1000);
    return { channels, source: "browser" };
  }

  async startNative(apiBase, device, settings = {}) {
    Object.assign(this.settings, settings);
    this.abort = new AbortController();
    const response = await fetch(`${apiBase}/capture?device=${encodeURIComponent(device)}`, { signal: this.abort.signal });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Native capture failed (${response.status}).`);
    const channels = Number(response.headers.get("x-channels")) || 1;
    const rate = Number(response.headers.get("x-rate")) || 16000;
    this.file = response.headers.get("x-file") || "";
    this.setup(channels, rate);
    this.read(response.body.getReader(), channels);
    return { channels, source: "native", file: this.file };
  }

  // Raw 32-bit float samples, interleaved (ch1 ch2 … ch1 ch2 …), cut into blocks of 1024 frames (64 ms at 16 kHz).
  async read(reader, channels) {
    const frameBytes = channels * 4;
    const blockFrames = 1024;
    let pending = new Uint8Array(0);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const joined = new Uint8Array(pending.length + value.length);
        joined.set(pending);
        joined.set(value, pending.length);
        let offset = 0;
        while (joined.length - offset >= blockFrames * frameBytes) {
          const frames = new Float32Array(joined.slice(offset, offset + blockFrames * frameBytes).buffer);
          const data = Array.from({ length: channels }, (_, c) => {
            const out = new Float32Array(blockFrames);
            for (let i = 0; i < blockFrames; i++) out[i] = frames[i * channels + c];
            return out;
          });
          this.block(data);
          offset += blockFrames * frameBytes;
        }
        pending = joined.slice(offset);
      }
      if (this.segmenters) this.onEnd?.("The native capture stopped. Check the server's terminal for ffmpeg's message.");
    } catch (error) {
      if (error.name !== "AbortError") this.onEnd?.(error.message);
    }
  }

  // Speech detection. With `auto` on (the default), each microphone's threshold follows its own background level: the
  // floor drops quickly to the quietest moments and rises slowly (and barely at all while that microphone is picking up
  // speech, so long talking doesn't lift the threshold into the voice). Speech starts 12 dB above the floor (and above
  // −60 dB) and keeps going until it drops to 6 dB above it. That copes with inputs whose gain is set low, where a fixed
  // threshold misses quiet talkers. With the bleed gate on, only the loudest microphone in use counts as speaking at
  // any moment: the person nearest a microphone is loudest on it, and the same voice on the others (bleed) is quieter.
  block(data) {
    if (!this.segmenters) return; // a block that arrived after stop()
    const startSample = this.samples;
    this.samples += data[0].length;
    const levels = data.map(rms);
    const { threshold, auto, bleedGate, enabled } = this.settings;
    this.floors ||= [];
    this.active ||= [];
    const detected = levels.map((level, c) => {
      const floor = this.floors[c] ?? level;
      const start = auto ? Math.max(floor * 4, 0.001) : threshold;
      const speaking = level > (this.active[c] ? start / 2 : start);
      this.active[c] = speaking;
      this.floors[c] = level < floor ? floor * 0.7 + level * 0.3 : speaking ? floor * 0.9997 + level * 0.0003 : floor * 0.997 + level * 0.003;
      return [speaking, start];
    });
    const thresholds = detected.map(([, start]) => start);
    const now = performance.now();
    if (now - this.lastLevels > 50) { this.lastLevels = now; this.onLevels(levels.map(toDb), thresholds.map(toDb)); }
    const loudest = Math.max(0, ...levels.filter((_, i) => enabled[i] !== false));
    data.forEach((samples, c) => {
      if (!this.segmenters?.[c]) return;
      const speaking = enabled[c] !== false && detected[c][0] && (!bleedGate || levels[c] >= loudest);
      this.segmenters[c].push(samples, speaking, startSample);
    });
  }

  // Stop, send off whatever was mid-utterance, and resolve to the browser recording (a Blob), or null for native
  // capture, whose recording is the WAV the server saved.
  async stop() {
    const segmenters = this.segmenters;
    this.segmenters = null;
    segmenters?.forEach((segmenter) => segmenter.flush());
    this.abort?.abort();
    let blob = null;
    if (this.media && this.media.state !== "inactive") {
      blob = await new Promise((resolve) => {
        this.media.onstop = () => resolve(new Blob(this.chunks, { type: this.media.mimeType || "audio/webm" }));
        this.media.stop();
      });
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.stream = this.context = this.media = this.abort = null;
    return blob;
  }
}
