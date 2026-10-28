import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/Chrome.jsx";
import Machine from "./Machine.jsx";

// mwRemix: the interview machine as it grew over one morning of tweaking (2026-10-28), offered as an example of what
// a remix can become. Everything it needs is in this folder (app/mw-remix/): the page, the component, the audio engine
// (recorder.mjs), its styles, its prompts (prompts.mjs), and its two server routes (api/transcribe, api/suggest).
// /machine is the simple base, and /remix is the student's copy of that base.

export const metadata = {
  title: "mwRemix",
  description: "Record an interview, transcribe it as you talk, and get follow-up questions for the producer.",
};

export default function MwRemixPage() {
  return (
    <>
      <SiteHeader current="mw-remix" />
      <main id="main" className="machine-shell">
        <header className="machine-heading">
          <p className="eyebrow">A worked example · <code>nextjs/app/mw-remix/</code></p>
          <h1>mwRemix</h1>
          <p className="lede">What the <Link href="/machine">machine</Link> became after a morning of asking for changes: an AI producer you steer by highlighting the transcript, fact checks with sources, a beat sheet for the host, and every AI-sourced question flagged. Start from <Link href="/remix">Remix</Link> and see where yours goes.</p>
                  </header>
        <Machine apiBase="/mw-remix/api" storageKey="tdm155ai-week-8:mw-remix" />
      </main>
      <SiteFooter />
    </>
  );
}
