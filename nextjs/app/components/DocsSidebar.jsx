import Link from "next/link";
import Markdown from "./Markdown.jsx";

// The sidebar pieces shared by the docs-style route (/docs).

// A folder's documents as links, with the folders inside it as headed groups (`top` leaves off the folder's own heading).
export function SidebarFolder({ folder, current, top = false }) {
  return (
    <div className={top ? "sidebar-group" : "sidebar-group sidebar-subgroup"}>
      {!top && <Link className="sidebar-heading" href={folder.href} aria-current={current === folder.href ? "page" : undefined}>{folder.title}</Link>}
      {folder.docs.map((doc) => <Link className="sidebar-link" key={doc.href} href={doc.href} aria-current={current === doc.href ? "page" : undefined}>{doc.title}</Link>)}
      {folder.folders.map((child) => <SidebarFolder key={child.href} folder={child} current={current} />)}
    </div>
  );
}

// A folder with no README of its own lists its documents, so the page isn't empty.
export function FolderContents({ folder }) {
  const docs = [...folder.docs, ...folder.folders.flatMap((child) => child.docs)];
  if (!docs.length) return <p className="empty-state">Nothing here yet. Add a Markdown file to <code>{folder.source}</code>.</p>;
  return (
    <ul className="docs-index">
      {docs.map((doc) => <li key={doc.href}><Link href={doc.href}>{doc.title}</Link>{doc.description && <span>{doc.description}</span>}</li>)}
    </ul>
  );
}

// The heading and body of the page beside the sidebar. A folder with no README lists its documents, unless the route
// passes its own list as `children`.
export function DocsArticle({ entry, eyebrow, children }) {
  const hasIntro = entry.content.trim().length > 0;
  return (
    <>
      <header className="docs-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{entry.title}</h1>
        {entry.description && <p className="lede">{entry.description}</p>}
        <p className="updated">
          {entry.updated && <>Updated {entry.updated} · </>}
          In the repo: <code>{entry.source}</code> · <Link className="print-link" href={`/print${entry.href}`}>Print {entry.kind === "folder" ? "this folder" : "this page"}</Link>
        </p>
      </header>
      {hasIntro && <article className="prose"><Markdown doc={entry} /></article>}
      {children ?? (entry.kind === "folder" && !hasIntro && <FolderContents folder={entry} />)}
    </>
  );
}

