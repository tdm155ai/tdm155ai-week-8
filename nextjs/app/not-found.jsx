import Link from "next/link";

export default function NotFound() {
  return <main id="main" className="not-found"><p className="eyebrow">404 / Not found</p><h1>This page isn’t in the folder.</h1><p>It may have moved, or the Markdown file may not exist yet.</p><Link href="/">Return home →</Link></main>;
}
