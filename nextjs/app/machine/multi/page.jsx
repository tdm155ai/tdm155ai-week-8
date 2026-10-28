import Link from "next/link";
import { SiteFooter, SiteHeader } from "../../components/Chrome.jsx";
import MultiMachine from "./MultiMachine.jsx";

// The multi-mic interview machine: 3 to 8 microphones on one interface (an 8-input Focusrite), one speaker per
// microphone. Browsers usually only hand a page 2 channels, so by default the local server captures the interface with
// ffmpeg (api/capture) and streams every channel to the page. Transcription and follow-ups use /machine/api.

export const metadata = {
  title: "Multi-mic interview machine",
  description: "An interview with more than two microphones: one speaker per input, transcribed as you talk.",
};

export default function MultiMachinePage() {
  return (
    <>
      <SiteHeader current="machine" />
      <main id="main" className="machine-shell">
        <header className="machine-heading">
          <p className="eyebrow"><Link href="/machine">Interview machine</Link> · more than 2 microphones</p>
          <h1>Multi-mic interview machine</h1>
          <p className="lede">For a host and several guests on an interface with more inputs: each microphone is one speaker. The Mac records every channel, and the transcript says who said what.</p>
        </header>
        <MultiMachine apiBase="/machine/api" captureBase="/machine/multi/api" storageKey="tdm155ai-week-8:multi" />
      </main>
      <SiteFooter />
    </>
  );
}
