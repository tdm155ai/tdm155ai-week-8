import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/Chrome.jsx";
import Machine from "./Machine.jsx";

// Remix: an identical copy of the recording machine (app/machine/), yours to change. Everything it needs is in this
// folder (app/remix/): the page, the component, the audio engine (recorder.mjs), its styles, and its server route
// (api/transcribe). Nothing you change here affects /machine. app/mw-remix/ is a worked example of how far it can go.

export const metadata = {
  title: "Remix",
  description: "Record an interview and get the transcript as you talk.",
};

export default function RemixPage() {
  return (
    <>
      <SiteHeader current="remix" />
      <main id="main" className="machine-shell">
        <header className="machine-heading">
          <p className="eyebrow">Record · transcribe · download · <code>nextjs/app/remix/</code></p>
          <h1>Remix</h1>
          <p className="lede">Record from your interface, see the transcript as you talk, and download it as Markdown. This is an identical copy of the <Link href="/machine">machine</Link>, yours to change; <Link href="/mw-remix">mwRemix</Link> shows where it can go.</p>
          <p className="machine-more"><Link href="/machine/multi">More than 2 microphones? Use the multi-mic interview machine →</Link></p>
                  </header>
        <Machine apiBase="/remix/api" storageKey="tdm155ai-week-8:remix" />
      </main>
      <SiteFooter />
    </>
  );
}
