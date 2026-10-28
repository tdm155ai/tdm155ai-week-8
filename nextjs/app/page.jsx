import { getRoot, site } from "../lib/content.mjs";
import { SiteFooter, SiteHeader } from "./components/Chrome.jsx";
import Markdown from "./components/Markdown.jsx";

export const dynamic = "force-dynamic";

// The home page is the intro (content/README.md).

export default async function Home() {
  const root = await getRoot();

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero hero-compact" aria-labelledby="site-title">
          <p className="eyebrow">{site.label} · {site.term}</p>
          <h1 id="site-title">{root.title === "Home" ? site.title : root.title}</h1>
          {root.description && <p className="hero-deck">{root.description}</p>}
          {root.content.trim() && <article className="prose hero-intro"><Markdown doc={root} /></article>}
        </section>

      </main>
      <SiteFooter />
    </>
  );
}
