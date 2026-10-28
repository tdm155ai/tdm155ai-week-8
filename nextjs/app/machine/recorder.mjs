// The machine's audio engine, in the browser. It opens one input (the Focusrite, or any microphone) with the browser's
// voice processing off, shows a level per channel, and cuts the sound into utterances: a stretch of speech that ends
// after a pause. Each utterance is handed back as a 16 kHz mono WAV, ready to send for transcription.
//
// Two modes:
// - "split": input 1 and input 2 (left and right) are two people, each cut on its own. A microphone also picks up
//   the other person a little ("bleed"); with the bleed gate on, a channel only counts as speaking when it's clearly
//   louder than the other one.
// - "mix": one voice track (one microphone, or everyone in the room), cut as one.
//
// It also records the whole session, untouched, so you can download it at the end.

const BLOCK = 2048; // samples per block from the worklet: about 43 ms at 48 kHz

// The AudioWorklet that copies the input out to the page, a block at a time, one array per channel.
const workletSource = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buffers = null; this.filled = 0; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    if (!this.buffers || this.buffers.length !== input.length) {
      this.buffers = input.map(() => new Float32Array(${BLOCK}));
      this.filled = 0;
    }
    for (let c = 0; c < input.length; c++) this.buffers[c].set(input[c], this.filled);
    this.filled += input[0].length;
    if (this.filled >= ${BLOCK}) {
      this.port.postMessage(this.buffers.map((b) => b.slice(0, this.filled)));
      this.filled = 0;
    }
    return true;
  }
}
registerProcessor("tap", Tap);
`;

export async function listInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput").map((device, i) => ({ id: device.deviceId, label: device.label || `Input ${i + 1}` }));
}

// Ask for the microphone once, so the input list has real names.
export async function askPermission() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
}

export function toDb(level) {
  return level > 0 ? Math.max(-60, 20 * Math.log10(level)) : -60;
}

// Average down to 16 kHz: plenty for speech, and a third the size of 48 kHz.
function downsample(samples, fromRate, toRate = 16000) {
  if (fromRate <= toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / (end - start || 1);
  }
  return out;
}

function wav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return buffer;
}

export function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// One channel's utterance cutter: speech starts a segment (with a little sound from just before), and a pause, or
// reaching the longest allowed segment, ends it. (The multi-mic machine, in multi/, uses it too.)
export class Segmenter {
  constructor(rate, onSegment, options) {
    this.rate = rate;
    this.onSegment = onSegment;
    this.options = options;
    this.preroll = [];
    this.blocks = null;
    this.quiet = 0;
    this.speech = 0;
  }

  push(block, speaking, startSample) {
    const seconds = block.length / this.rate;
    if (!this.blocks) {
      this.preroll.push({ block, startSample });
      if (this.preroll.length > 6) this.preroll.shift();
      if (!speaking) return;
      this.blocks = this.preroll.map((item) => item.block);
      this.start = this.preroll[0].startSample;
      this.length = this.blocks.reduce((sum, b) => sum + b.length, 0);
      this.preroll = [];
      this.quiet = 0;
      this.speech = seconds;
      return;
    }
    this.blocks.push(block);
    this.length += block.length;
    if (speaking) { this.speech += seconds; this.quiet = 0; } else this.quiet += seconds;
    if (this.quiet >= this.options.pause || this.length / this.rate >= this.options.longest) this.flush();
  }

  flush() {
    if (!this.blocks) return;
    const blocks = this.blocks;
    this.blocks = null;
    if (this.speech < this.options.shortest) return;
    const joined = new Float32Array(blocks.reduce((sum, b) => sum + b.length, 0));
    let offset = 0;
    for (const b of blocks) { joined.set(b, offset); offset += b.length; }
    const rate = 16000;
    this.onSegment({ start: this.start / this.rate, seconds: joined.length / this.rate, wav: wav(downsample(joined, this.rate, rate), rate) });
  }
}

export class Recorder {
  // onLevels([dB, dB]) about 20 times a second; onSegment({ channel, start, seconds, wav }) for each utterance.
  constructor({ onLevels, onSegment }) {
    this.onLevels = onLevels;
    this.onSegment = onSegment;
    // auto: each input's threshold follows its own background level (see threshold() below); threshold: the fixed level
    // (0–1) that counts as speech when auto is off; pause: seconds of quiet that end an utterance; longest: the
    // longest utterance before it's cut anyway; shortest: less speech than this is dropped (a cough, a click).
    this.settings = { mode: "split", auto: true, threshold: 0.02, bleedGate: true, pause: 0.8, longest: 15, shortest: 0.4 };
  }

  async start(deviceId, settings = {}) {
    Object.assign(this.settings, settings);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.context = new AudioContext();
    const url = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
    await this.context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = this.context.createMediaStreamSource(this.stream);
    this.tap = new AudioWorkletNode(this.context, "tap", { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "discrete" });
    const mute = this.context.createGain();
    mute.gain.value = 0;
    source.connect(this.tap).connect(mute).connect(this.context.destination);

    this.channels = this.stream.getAudioTracks()[0].getSettings().channelCount || 1;
    this.samples = 0;
    this.floors = [];
    const rate = this.context.sampleRate;
    const options = this.settings;
    this.segmenters = [0, 1].map((channel) => new Segmenter(rate, (segment) => this.onSegment({ channel, ...segment }), options));
    let lastLevels = 0;
    this.tap.port.onmessage = ({ data }) => this.block(data, rate, (levels, thresholds) => {
      const now = performance.now();
      if (now - lastLevels > 50) { lastLevels = now; this.onLevels(levels.map(toDb), thresholds.map(toDb)); }
    });

    this.chunks = [];
    this.media = new MediaRecorder(this.stream);
    this.media.ondataavailable = (event) => event.data.size && this.chunks.push(event.data);
    this.media.start(1000);
    return { channels: this.channels, rate };
  }

  // With auto on, a level counts as speech when it's 12 dB above that input's background (and above −60 dB): the
  // background drops quickly to the quietest moments and rises slowly, which copes with inputs whose gain is set low.
  // `key` is the input (0, 1), or 2 for the mixed signal.
  threshold(key, level) {
    const floor = this.floors[key] ?? level;
    this.floors[key] = level < floor ? floor * 0.7 + level * 0.3 : floor * 0.997 + level * 0.003;
    return this.settings.auto ? Math.max(this.floors[key] * 4, 0.001) : this.settings.threshold;
  }

  block(data, rate, showLevels) {
    const startSample = this.samples;
    this.samples += data[0].length;
    // With a mono input (or a stereo one with nothing on the right), there is only one voice to cut.
    const left = data[0];
    const right = this.channels > 1 && data[1] ? data[1] : data[0];
    const levels = [rms(left), rms(right)];
    const thresholds = levels.map((level, c) => this.threshold(c, level));
    const { mode, bleedGate } = this.settings;
    // A mono microphone often arrives as the same sound on both sides; then there's one voice, not two.
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference += (left[i] - right[i]) ** 2;
    const same = Math.sqrt(difference / left.length) < 0.05 * Math.max(levels[0], levels[1], 1e-6);
    if (mode === "mix" || same) {
      const mixed = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) mixed[i] = (left[i] + right[i]) / 2;
      const level = rms(mixed);
      const threshold = this.threshold(2, level);
      showLevels(levels, [threshold, threshold]);
      this.segmenters[0].push(mixed, level > threshold, startSample);
      return;
    }
    showLevels(levels, thresholds);
    // With the bleed gate on, only the louder microphone counts as speaking: the same voice is quieter on the other one.
    [left, right].forEach((samples, c) => {
      const speaking = levels[c] > thresholds[c] && (!bleedGate || levels[c] >= levels[1 - c]);
      this.segmenters[c].push(samples, speaking, startSample);
    });
  }

  // Stop, send off whatever was mid-utterance, and resolve to the whole session as one audio file (a Blob).
  async stop() {
    this.segmenters?.forEach((segmenter) => segmenter.flush());
    const recorded = new Promise((resolve) => {
      if (!this.media || this.media.state === "inactive") return resolve(null);
      this.media.onstop = () => resolve(new Blob(this.chunks, { type: this.media.mimeType || "audio/webm" }));
      this.media.stop();
    });
    const blob = await recorded;
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.stream = this.context = this.media = this.segmenters = null;
    return blob;
  }
}
