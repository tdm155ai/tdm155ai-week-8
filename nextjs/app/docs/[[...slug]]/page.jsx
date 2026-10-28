import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntry } from "../../../lib/content.mjs";
import { SiteFooter, SiteHeader } from "../../components/Chrome.jsx";
import { DocsArticle, SidebarFolder } from "../../components/DocsSidebar.jsx";

// Read the Markdown on each request so edits and new files appear on refresh.
export const dynamic = "force-dynamic";

// content/docs/ as a docs site: every document in the folder, and in the folders inside it, listed in a sidebar
// (folders as headed groups), and the one you pick beside it. /docs shows docs/README.md. No previous/next
// pager: you move between documents with the sidebar.

async function find(params) {
  const { slug = [] } = await params;
  const docs = (await getEntry(["docs"]))?.entry;
  if (!docs) return null;
  if (!slug.length) return { docs, entry: docs, section: "docs" };
  const found = await getEntry(["docs", ...slug]);
  return found ? { docs, entry: found.entry, section: "docs" } : null;
}

export async function generateMetadata({ params }) {
  const found = await find(params);
  return found ? { title: found.entry.title, description: found.entry.description } : {};
}

export default async function DocsPage({ params }) {
  const found = await find(params);
  if (!found) notFound();
  const { docs, entry } = found;

  return (
    <>
      <SiteHeader current={found.section} />
      <div className="docs-shell">
        <aside className="docs-sidebar">
          <Link className="eyebrow sidebar-title" href={docs.href} aria-current={entry === docs ? "page" : undefined}>{docs.title}</Link>
          <nav aria-label={`${docs.title} contents`}>
            <SidebarFolder folder={docs} current={entry.href} top />
            {docs.count === 0 && <p className="sidebar-empty">Nothing here yet.</p>}
          </nav>
        </aside>
        <main id="main" className="docs-main">
          <DocsArticle entry={entry} eyebrow={entry === docs ? "Docs" : entry.eyebrow} />
        </main>
      </div>
      <SiteFooter />
    </>
  );
}
