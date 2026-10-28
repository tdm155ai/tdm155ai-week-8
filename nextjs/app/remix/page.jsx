import { SiteFooter, SiteHeader } from "../components/Chrome.jsx";
import Machine from "./Machine.jsx";

// Your copy of the recording and interviewing machine: change anything. It started as an exact copy of app/machine/,
// and everything it needs is in this folder: the page, the component, the audio engine (recorder.mjs), its styles, and
// its two server routes (api/transcribe, api/suggest). Nothing you change here affects /machine.

export const metadata = {
  title: "Remix",
  description: "Record an interview, transcribe it as you talk, and get follow-up questions for the producer.",
};

export default function RemixPage() {
  return (
    <>
      <SiteHeader current="remix" />
      <main id="main" className="machine-shell">
        <header className="machine-heading">
          <p className="eyebrow">Your copy of the machine · <code>nextjs/app/remix/</code></p>
          <h1>Remix</h1>
          <p className="lede">The same machine, yours to change. Ask Claude Code to add a feature, change what the AI suggests, or redesign the page.</p>
        </header>
        <Machine apiBase="/remix/api" storageKey="tdm155ai-week-8:remix" />
      </main>
      <SiteFooter />
    </>
  );
}
