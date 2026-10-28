# TDM 155AI week 8: instructions for AI assistants

This repository is the week 8 site for TDM 155AI (*Making Stuff in the Age of AI*): Interviewing and podcasting (class October 28, 2026). Students learn to record a podcast and to interview each other, and be interviewed, about their creative projects: their choices, their use of AI, and what they added as people. Three jobs rotate: host, guest, and producer (who runs the pre-interview and passes the host follow-ups during the live interview).

## Where things go

- **`nextjs/content/`**: the Markdown the site shows; each file is a page at the same path. `content/docs/` is the Docs section, shown with a sidebar at `/docs`.
- **`nextjs/app/machine/`**: the recording machine in its simplest form (record, transcribe as you talk, download Markdown). Don't change it when a student asks for changes; change their copy. `machine/multi/` is the multi-mic version, and `machine/api/suggest/` exists only for it.
- **`nextjs/app/remix/`**: the student's copy of the machine. This is where student changes go. It's self-contained: `page.jsx`, `Machine.jsx` (the page's controls and logic), `recorder.mjs` (the audio engine in the browser), `machine.module.css` (its styles), and `api/transcribe/` (its server route). Changing it never affects `/machine`.
- **`nextjs/app/mw-remix/`**: a worked example of what a remix can become (an AI producer steered by highlighting the transcript, research with sources, a beat sheet, AI-sourced questions flagged). Students can read it for ideas and copy from it; don't change it for them either. Its prompts are in `prompts.mjs`, which its page and routes share.

See `README.md` for how the machine works.

## Writing docs

Every Markdown file you write starts with YAML frontmatter giving its title, a one-line description, and you as its author, so the student (and anyone reading) can tell your work from theirs:

```yaml
---
title: Interview questions for a sound piece
description: Follow-ups for a guest who made audio
author: claude
---
```

Don't put an H1 in the body; the title comes from the frontmatter. `order:` sets a document's place in the sidebar.

## The app

- The student runs it themselves: `cd nextjs`, `pnpm install`, `pnpm dev`. Don't start it in the background.
- Plain JavaScript with its own CSS; no TypeScript or Tailwind.
- API keys live in the gitignored root `.env` (template `.env.example`) and are read only by the server routes (`lib/keys.mjs`). Never put a key in browser code, and never print one.
