import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntry, isAiGenerated } from "../../lib/content.mjs";
import { SiteFooter, SiteHeader } from "../components/Chrome.jsx";
import Markdown from "../components/Markdown.jsx";

// Content is edited while the app runs; always read the current files.
export const dynamic = "force-dynamic";

// Every file and folder in content/ (content/docs/a.md is /docs/a); see lib/content.mjs. /docs has its own
// route (app/docs/). Nothing is prerendered: pages read the current files on each request.

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const found = await getEntry(slug);
  return found ? { title: found.entry.title, description: found.entry.description } : {};
}

function Breadcrumbs({ trail, title }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link href="/">Home</Link>
      {trail.map((folder) => <span key={folder.slug} className="breadcrumb-step"><span>/</span><Link href={folder.href}>{folder.title}</Link></span>)}
      <span>/</span><span>{title}</span>
    </nav>
  );
}

function FolderList({ folder }) {
  const items = [...folder.folders, ...folder.docs];
  if (!items.length) return <p className="empty-state">Nothing here yet.</p>;
  return (
    <nav className="document-list" aria-label={`In ${folder.title}`}>
      {items.map((item, index) => (
        <Link className="document-link" href={item.href} key={item.slug}>
          <span className="document-number">{item.kind === "folder" ? "▸" : String(index + 1 - folder.folders.length).padStart(2, "0")}</span>
          <span className="document-copy">
            <span className="eyebrow">{item.kind === "folder" ? `Folder · ${item.count} document${item.count === 1 ? "" : "s"}` : item.eyebrow}</span>
            <strong>{item.title}</strong>
            {item.description && <span>{item.description}</span>}
          </span>
          <span className="document-arrow" aria-hidden="true">↗</span>
        </Link>
      ))}
    </nav>
  );
}

export default async function EntryPage({ params }) {
  const { slug } = await params;
  const found = await getEntry(slug);
  if (!found) notFound();
  const { entry, trail, siblings } = found;
  const position = siblings.indexOf(entry);
  const previous = position > 0 ? siblings[position - 1] : null;
  const next = position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : null;
  const folderPath = entry.source;

  return (
    <>
      <SiteHeader />
      <main id="main" className="article-shell">
        <Breadcrumbs trail={trail} title={entry.title} />
        <header className="article-heading">
          {isAiGenerated(entry) && <p className="ai-badge">AI-generated</p>}
          <p className="eyebrow">{entry.kind === "folder" ? `Folder · ${entry.count} document${entry.count === 1 ? "" : "s"}` : entry.eyebrow}</p>
          <h1>{entry.title}</h1>
          {entry.description && <p className="lede">{entry.description}</p>}
          {entry.updated && <p className="updated">Updated {entry.updated}</p>}
          <p className="updated">In the repo: <code>{folderPath}</code> · <Link className="print-link" href={`/print${entry.href}`}>Print {entry.kind === "folder" ? "this folder" : "this page"}</Link></p>
        </header>
        {entry.kind === "folder" ? (
          <>
            {entry.tools.length > 0 && (
              <nav className="folder-tools" aria-label="Tools">
                {entry.tools.map((tool) => (
                  <Link href={tool.href} className="folder-tool" key={tool.href}>
                    <span className="folder-tool-title">{tool.title} <span aria-hidden="true">→</span></span>
                    {tool.copy && <span className="folder-tool-copy">{tool.copy}</span>}
                  </Link>
                ))}
              </nav>
            )}
            {entry.tool && !entry.tools.length && (
              <Link href={entry.tool} className="practice-cta folder-cta">
                <span className="practice-cta-eyebrow">The tool for this step</span>
                <span className="practice-cta-title">{entry.toolTitle} <span aria-hidden="true">→</span></span>
                {entry.toolCopy && <span className="practice-cta-copy">{entry.toolCopy}</span>}
              </Link>
            )}
            {entry.content.trim() && <article className="prose folder-intro"><Markdown doc={entry} /></article>}
            {entry.listHeading && <h2 className="folder-list-heading">{entry.listHeading}</h2>}
            <FolderList folder={entry} />
          </>
        ) : (
          <article className="prose"><Markdown doc={entry} /></article>
        )}
        {(previous || next) && <nav className="pager" aria-label="More in this folder">
          {previous ? <Link href={previous.href}><span className="eyebrow">← Previous</span><strong>{previous.title}</strong></Link> : <span />}
          {next ? <Link className="pager-next" href={next.href}><span className="eyebrow">Next →</span><strong>{next.title}</strong></Link> : <span />}
        </nav>}
      </main>
      <SiteFooter />
    </>
  );
}
