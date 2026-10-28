import { readFile } from "node:fs/promises";
import path from "node:path";
import { mediaFile } from "../../../lib/content.mjs";

export const dynamic = "force-dynamic";

// Images beside the Markdown (pictures a document embeds) in content/ (/context-media/docs/...), and PDFs a
// document links to. Markdown.jsx points relative image and PDF links here. Only those types, and nothing outside content/.
const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf" };

export async function GET(request, { params }) {
  const { path: segments } = await params;
  const file = mediaFile(segments);
  const type = file && types[path.extname(file).toLowerCase()];
  if (!type) return new Response("Not found", { status: 404 });
  try {
    return new Response(await readFile(/* turbopackIgnore: true */ file), { headers: { "Content-Type": type, "Cache-Control": "no-cache" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
