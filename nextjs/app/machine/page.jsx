import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/Chrome.jsx";
import Machine from "./Machine.jsx";

// Marlon's interview machine. Everything it needs is in this folder (app/machine/): the page, the
// component, the audio engine (recorder.mjs), its styles, and its two server routes (api/transcribe, api/suggest).
// app/remix/ is a copy for students to change.

export const metadata = {
  title: "Interview machine",
  description: "Record an interview, transcribe it as you talk, and get follow-up questions for the producer.",
};

export default function MachinePage() {
  return (
    <>
      <SiteHeader current="machine" />
      <main id="main" className="machine-shell">
        <header className="machine-heading">
          <p className="eyebrow">Record · transcribe · follow up</p>
          <h1>Interview machine</h1>
          <p className="lede">Record from your interface, see the transcript as you talk, and get follow-up questions for the producer.</p>
          <p className="machine-more"><Link href="/machine/multi">More than 2 microphones? Use the multi-mic interview machine →</Link></p>
        </header>
        <Machine apiBase="/machine/api" storageKey="tdm155ai-week-8:machine" />
      </main>
      <SiteFooter />
    </>
  );
}
