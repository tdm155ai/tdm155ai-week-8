# tdm155ai-week-8

TDM 155AI week 8 (class 2026-10-28): Interviewing, being interviewed, and podcasting. A local Next app in `nextjs/` with three parts, one per link in the nav:

- **Docs** (`/docs`, Markdown in `nextjs/content/docs/`): question tips for host, guest, and producer, recording a two-person podcast in GarageBand, and the gear and transcription models.
- **Machine** (`/machine`, code in `nextjs/app/machine/`): the recording and interviewing machine. It records from an audio interface (a Focusrite with two microphones: input 1 and input 2 are two people) or any microphone, cuts the sound into utterances at each pause, transcribes each one as it ends, and gives the producer follow-up questions from the pre-interview notes and the transcript so far.
- **Remix** (`/remix`, code in `nextjs/app/remix/`): an exact copy of the machine for students to change. Everything it needs is in its folder, including its own server routes and styles, so changing it never touches `/machine`.

Private; nested in the Learning Lab's Notebook at `apps/tdm155ai/tdm155ai-week-8/`.

## Run it

Copy `.env.example` to `.env` at the repo root and add the keys (only `OPENROUTER_API_KEY` is needed for the machine). Then:

```
cd nextjs
pnpm install
pnpm dev
```

Open http://localhost:3000/machine in Chrome. The browser asks for the microphone; under Setup, **Find inputs** lists the interface by name.

## How the machine works

- `recorder.mjs` (in the browser): opens the input with the browser's voice processing off (no echo cancellation, noise suppression, or auto gain), shows a meter per input, and cuts each input into utterances: speech starts one, 0.8 seconds of quiet (or 15 seconds of talking) ends it. With two microphones each person is cut separately, and the **bleed gate** only counts a microphone as speaking when it's clearly louder than the other one, so the guest's voice picked up by the host's microphone isn't transcribed twice. A mono input arriving as the same sound on both sides is treated as one voice. It also records the whole session for download.
- `api/transcribe/route.js`: sends each utterance (16 kHz mono WAV) to OpenRouter's speech-to-text endpoint (default `openai/gpt-4o-mini-transcribe`; also GPT-4o transcribe, ElevenLabs Scribe v2, Voxtral), or to a local Whisper server at `WHISPER_URL` (for example whisper.cpp's `whisper-server`), so nothing leaves the computer.
- `api/suggest/route.js`: sends the producer's instructions (editable on the page), the pre-interview notes, and the transcript to a Claude model on OpenRouter (default Claude Haiku 5.5) and returns follow-up questions. Clicking a question shows it full screen for the host.
- The session (transcript, notes, suggestions, settings) is kept in the browser's localStorage and can be downloaded as Markdown; the recording downloads as WebM.

Monitoring is the interface's job: turn on **Direct Monitor** on the Focusrite. GarageBand can record from the same interface at the same time; see `nextjs/content/docs/garageband.md`.

## Where it came from

**Copied 2026-10-28 from `tdm155ai/tdm155ai-week-7` at `91d0555`**, the Markdown-rendering parts of its Next app only: `lib/content.mjs`, the catch-all page, `/print`, `/context-media`, the Markdown and sidebar components, and the CSS. Week 7's `/resources` docs route became `/docs`. Left behind: the resource sheets, the Tools tab, `utils/`, and the editing skills. The accent changed from amber to red.

The machine was written by Claude on 2026-10-28, the morning of class. Tested that day: both server routes against the real APIs (GPT-4o mini transcribe and Scribe v2 returned a test sentence exactly, in about 2.5 seconds; Claude Haiku 5.5 returned three usable follow-ups), and the whole page in a browser with a simulated two-channel input (a voice on input 1, then input 2, came back as Host and Guest). **Not yet tested with a real Focusrite.**
