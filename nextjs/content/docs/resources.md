---
title: Gear and tools
description: The interface, headphones, levels, and the transcription models
author: claude
order: 3
---

## The interface

The Focusrite turns the microphone signal into audio the Mac can record. Each input has its own gain knob. With two microphones, input 1 and input 2 arrive as the left and right channels of one stereo signal. The machine uses that to tell the host's voice from the guest's.

## Headphones

The Focusrite's headphone output takes a 1/4" plug, and most headphones have a 1/8" (3.5 mm) plug, so you need an adapter. If there aren't enough, see "Hearing yourself" in [A podcast in GarageBand](garageband.md).

## Transcription

The machine sends your audio, a few seconds at a time, to a speech-to-text model through OpenRouter, using the key in the repo's `.env`. You can switch models in the machine's settings:

- `openai/gpt-4o-mini-transcribe`: fast and cheap. The default.
- `openai/gpt-4o-transcribe`: more accurate and slower.
- `elevenlabs/scribe-v2`: ElevenLabs' transcription model.
- `mistralai/voxtral-mini-transcribe-3-0`: very cheap.

To run Whisper on your own Mac instead, start a local Whisper server (for example whisper.cpp's `whisper-server`), set `WHISPER_URL` in `.env` to its address (for whisper.cpp, something like `http://127.0.0.1:8080/inference`), and choose **Local Whisper**. Nothing then leaves the computer.

## Follow-up suggestions

The producer panel sends the pre-interview transcript and the live transcript to a Claude model on OpenRouter and asks for follow-ups. The instructions it sends are in a box on the page, and you can rewrite them. In the Remix copy, you can change anything.
