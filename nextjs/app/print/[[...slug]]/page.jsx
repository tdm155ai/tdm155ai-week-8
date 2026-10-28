import { notFound } from "next/navigation";
import { getEntries, getEntry, getRoot, isAiGenerated, site } from "../../../lib/content.mjs";
import Markdown from "../../components/Markdown.jsx";

export const dynamic = "force-dynamic";

// /print                 the index
// /print/all             every document, one per sheet
// /print/set             the documents named by `print_set:` in the frontmatter of content/README.md
// /print/<folder>        the folder's README, then every document under it, one per sheet
// /print/<folder>/<doc>  one document: any page's address with /print in front

function PrintBar({ hint }) {
  return (
    <header className="print-bar">
      <span>{site.title} · {site.label}</span>
      <span>{hint || "⌘P to print · Letter"}</span>
    </header>
  );
}

function Sheet({ entry, pageBreak }) {
  return (
    <article className={pageBreak ? "print-card page-break" : "print-card"}>
      <p className="eyebrow">{isAiGenerated(entry) ? "AI-generated · " : ""}{entry.kind === "folder" ? "Folder" : entry.eyebrow}</p>
      <h1>{entry.title}</h1>
      {entry.description && <p className="lede">{entry.description}</p>}
      {entry.content.trim() && <div className="prose"><Markdown doc={entry} print /></div>}
    </article>
  );
}

function Sheets({ entries, hint }) {
  return (
    <main className="print-main">
      <PrintBar hint={hint || `${entries.length} sheet${entries.length === 1 ? "" : "s"} · ⌘P to print`} />
      {entries.map((entry, index) => <Sheet entry={entry} key={entry.href} pageBreak={index > 0} />)}
      {entries.length === 0 && <p>Nothing to print yet.</p>}
    </main>
  );
}

// A folder prints its README (when it says something) and then every document under it, depth first.
function folderSheets(folder) {
  const out = folder.content.trim() ? [folder] : [];
  out.push(...folder.docs);
  for (const child of folder.folders) out.push(...folderSheets(child));
  return out;
}

export async function generateMetadata({ params }) {
  const { slug = [] } = await params;
  if (!slug.length) return { title: "Printables" };
  if (slug.length === 1 && (slug[0] === "all" || slug[0] === "set")) return { title: slug[0] === "all" ? "Everything" : "The print set" };
  const found = await getEntry(slug);
  return { title: found?.entry.title || "Print" };
}

export default async function PrintPage({ params }) {
  const { slug = [] } = await params;
  const root = await getRoot();
  const docs = (await getEntries()).filter((entry) => entry.kind === "doc");
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  const printSet = (Array.isArray(root.data?.print_set) ? root.data.print_set : []).map((key) => bySlug.get(String(key).replace(/^\/|\.md$/g, ""))).filter(Boolean);

  if (slug.length === 0) {
    return (
      <main className="print-main">
        <PrintBar hint="index" />
        <h1>Printables</h1>
        <p className="lede">Every page prints on its own sheet. Put <code>/print</code> in front of any page's address, or use the links below.</p>
        <ul className="print-index">
          {printSet.length > 0 && <li><a href="/print/set">The print set</a>: {printSet.map((doc) => doc.title).join(" · ")}</li>}
          <li><a href="/print/all">Everything</a>: every document, one per sheet ({docs.length})</li>
          {root.docs.map((doc) => <li key={doc.slug}><a href={`/print${doc.href}`}>{doc.title}</a></li>)}
          {root.folders.map((folder) => (
            <li key={folder.slug}>
              <a href={`/print${folder.href}`}>{folder.title}</a> ({folder.count}): {folderSheets(folder).filter((entry) => entry.kind === "doc").map((doc, index) => <span key={doc.slug}>{index > 0 && " · "}<a href={`/print${doc.href}`}>{doc.title}</a></span>)}
            </li>
          ))}
        </ul>
        {printSet.length === 0 && <p className="print-hint">To pick a set for a session, list documents in the frontmatter of <code>nextjs/content/README.md</code>: <code>print_set: [docs/questions, docs/garageband]</code>.</p>}
      </main>
    );
  }

  if (slug.length === 1 && slug[0] === "all") return <Sheets entries={[...(root.content.trim() ? [root] : []), ...folderSheets({ ...root, content: "" })]} />;
  if (slug.length === 1 && slug[0] === "set") return <Sheets entries={printSet} hint={`The print set · ${printSet.length} sheets · ⌘P to print`} />;

  const found = await getEntry(slug);
  if (!found) notFound();
  const { entry } = found;
  if (entry.kind === "folder") return <Sheets entries={folderSheets(entry)} />;
  return <main className="print-main"><PrintBar /><Sheet entry={entry} /></main>;
}
