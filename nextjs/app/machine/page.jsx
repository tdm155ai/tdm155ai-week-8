import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/Chrome.jsx";
import Machine from "./Machine.jsx";

// The recording machine, as simple as it gets: record, transcribe as you talk, download the transcript as Markdown.
// Everything it needs is in this folder (app/machine/): the page, the component, the audio engine (recorder.mjs), its
// styles, and its server route (api/transcribe). app/remix/ is a copy for students to change, and app/mw-remix/ is a
// worked example of how far it can go. api/suggest here serves the multi-mic machine at /machine/multi.

export const metadata = {
  title: "Interview machine",
  description: "Record an interview and get the transcript as you talk.",
};

export default function MachinePage() {
  return (
    <>
      <SiteHeader current="machine" />
      <main id="main" className="machine-shell">
        <header className="machine-heading">
          <p className="eyebrow">Record · transcribe · download</p>
          <h1>Interview machine</h1>
          <p className="lede">Record from your interface, see the transcript as you talk, and download it as Markdown. That's the whole mechanic: <Link href="/remix">Remix</Link> is your copy to build on, and <Link href="/mw-remix">mwRemix</Link> shows where it can go.</p>
          <p className="machine-more"><Link href="/machine/multi">More than 2 microphones? Use the multi-mic interview machine →</Link></p>
        </header>
        <Machine apiBase="/machine/api" storageKey="tdm155ai-week-8:machine" />
      </main>
      <SiteFooter />
    </>
  );
}
