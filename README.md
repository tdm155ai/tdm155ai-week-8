# tdm155ai-week-8

TDM 155AI week 8 (class 2026-10-28): Interviewing, being interviewed, and podcasting. A local Next app in `nextjs/` with three parts, one per link in the nav:

- **Docs** (`/docs`, Markdown in `nextjs/content/docs/`): question tips for host, guest, and producer, recording a two-person podcast in GarageBand, and the gear and transcription models.
- **Interview machine** (`/machine`, code in `nextjs/app/machine/`): the mechanic at its simplest. It records from an audio interface (a Focusrite with two microphones: input 1 and input 2 are two people) or any microphone, cuts the sound into utterances at each pause, transcribes each one as it ends, and downloads the transcript as Markdown (and the recording as audio). No AI producer.
- **Multi-mic interview machine** (`/machine/multi`, code in `nextjs/app/machine/multi/`, linked from the Interview machine page): for a host and several guests on an interface with more inputs (an 8-input Focusrite), one speaker per microphone. Browsers usually hand a page only 2 channels, so by default the local server captures the interface with Homebrew's ffmpeg (`api/capture`), streams every channel to the page at 16 kHz, and saves the whole session as one multichannel WAV in `_media/multi/`; after Stop it downloads as an MP3 mix or the full WAV, and **Delete from this Mac** removes the WAV. macOS asks once for microphone access for the app the server runs in (run `pnpm dev` from Terminal). A Browser capture option is there too, for a browser that delivers more than 2 channels. It keeps the original AI follow-ups, through `machine/api/suggest`.
- **Remix** (`/remix`, code in `nextjs/app/remix/`): an identical copy of the interview machine for students to change, or fork mwRemix instead if they'd rather start from the full version. Everything it needs is in its folder, including its own server route and styles, so changing it never touches `/machine`.
- **mwRemix** (`/mw-remix`, code in `nextjs/app/mw-remix/`): what the machine became after a morning of asking for changes (2026-10-28), offered as an example of what a remix can reach. See *How mwRemix works* below.

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

The simple machine (`/machine`, and the Remix copy) is the first bullet and the transcription route below. mwRemix adds the rest.

- `recorder.mjs` (in the browser): opens the input with the browser's voice processing off (no echo cancellation, noise suppression, or auto gain), shows a meter per input, and cuts each input into utterances: speech starts one, 0.8 seconds of quiet (or 15 seconds of talking) ends it. Speech detection is automatic by default: each input learns its own background level, speech starts 12 dB above it and continues until it drops to 6 dB above it, and the background barely moves while someone is talking, so long stretches of speech don't lift the threshold into the voice (a fixed threshold is still an option). That copes with low gain and with laptop microphones. With two microphones each person is cut separately, and the **bleed gate** only counts the louder microphone as speaking, so the guest's voice picked up by the host's microphone isn't transcribed twice. A mono input arriving as the same sound on both sides is treated as one voice. It also records the whole session for download.
- `api/transcribe/route.js`: sends each utterance (16 kHz mono WAV), with a hint naming the speakers and terms (editable on the page), to OpenRouter's speech-to-text endpoint (default `openai/gpt-4o-mini-transcribe`; also GPT-4o transcribe, ElevenLabs Scribe v2, Voxtral), or to a local Whisper server at `WHISPER_URL` (for example whisper.cpp's `whisper-server`), so nothing leaves the computer.
- **mwRemix only.** `api/suggest/route.js`: sends the producer's instructions (editable on the page), the pre-interview notes, and the transcript to a Claude model on OpenRouter (default Claude Haiku 5.5). Three modes: **Starter question** (one opening question, from the notes); and, when the producer highlights a passage of the transcript, a popover with a one-line note box and two buttons, **Question** (follow-ups about that passage) and **Research** (check or look into a claim in it; this turns on OpenRouter's web search with the Exa engine, which costs a little more, and the finding is one short paragraph with the pages it used folded underneath). There is no automatic cadence: the AI only speaks when asked. Clicking a question or a finding shows it full screen for the host.
- **Beat sheet.** A button beside Download .md asks the AI for a one-page producer's brief for the host, from the notes and the transcript (usually a pre-interview or a practice run): the guest, the one thing, four to six beats in order, the best questions, names and terms, what to handle with care, and claims to check before air. It downloads as Markdown.
- **What gets sent** (`prompts.mjs`): every prompt is in one file that the page and both routes import, and a panel on the page, open before recording, shows the transcription request with its hint, the system instructions (editable), the three asks, and a Question request as it goes out. Students see everything the AI is told before they press Record.
- **AI-sourced lines.** Whatever the AI contributed that reaches the conversation is flagged in the transcript (a badge and a dashed edge), as opposed to an organic question that arose from the conversation. A suggestion the host reads out is recognized when its transcription comes back (most of its words match), and **Asked** / **Used** logs a suggestion the host took up without reading it word for word, or showed on the big card. Either way the suggestion then leaves the list (so does a skipped one), so the newest suggestions are always at the top. Any line's mark can be flipped by hand (hover for *mark AI* / *mark organic*). The Markdown download keeps the flags and counts them in its frontmatter.
- Both machines keep the session (transcript, settings, and in mwRemix the notes and suggestions) in the browser's localStorage and can be downloaded as Markdown; the recording downloads as WebM.

Monitoring is the interface's job: turn on **Direct Monitor** on the Focusrite. GarageBand can record from the same interface at the same time; see `nextjs/content/docs/garageband.md`.

## Where it came from

**Copied 2026-10-28 from `tdm155ai/tdm155ai-week-7` at `91d0555`**, the Markdown-rendering parts of its Next app only: `lib/content.mjs`, the catch-all page, `/print`, `/context-media`, the Markdown and sidebar components, and the CSS. Week 7's `/resources` docs route became `/docs`. Left behind: the resource sheets, the Tools tab, `utils/`, and the editing skills. The accent changed from amber to red.

The machine was written by Claude on 2026-10-28, the morning of class. Tested that day: both server routes against the real APIs (GPT-4o mini transcribe and Scribe v2 returned a test sentence exactly, in about 2.5 seconds; Claude Haiku 5.5 returned three usable follow-ups), and the whole page in a browser with a simulated two-channel input (a voice on input 1, then input 2, came back as Host and Guest). Marlon confirmed audio and transcript working with the Scarlett 2i2 the same morning. The multi-mic machine was tested with a stand-in for ffmpeg that played a voice on input 3 of a fake 8-channel input (it came back labeled Guest 2, and the 8-channel WAV was saved); **not yet tested with a real 8-input interface**, and native capture failed with a microphone-permission block when the server was started by an agent rather than from Terminal.
