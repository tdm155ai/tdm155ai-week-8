@AGENTS.md

# TDM 155AI week 8: the app

A Next app that renders the Markdown in `content/` (its README is the home page; `content/a/b.md` is `/a/b`) (`lib/content.mjs`). `/docs` (`app/docs/`) shows `content/docs/` as a docs site with a sidebar (`app/components/DocsSidebar.jsx`). The header nav is Docs, Machine, Remix (`app/components/Chrome.jsx`). `/machine` (`app/machine/`) is the recording and interviewing machine, and `/remix` (`app/remix/`) is a self-contained copy for students to change; each has its own `api/transcribe` and `api/suggest` routes, which read keys from the repo's root `.env` through `lib/keys.mjs`. Every other file and folder renders through the catch-all `app/[...slug]/`; images beside a doc are served by `app/context-media/`, and a light `/print` renders any page. See the repo `README.md`.
