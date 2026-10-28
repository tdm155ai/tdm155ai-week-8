import { readFile } from "node:fs/promises";
import path from "node:path";

// API keys for the machine's server routes. A key set in the environment wins; otherwise it comes from the repo's
// root .env (one level above nextjs/), read on every call so an edit to .env applies without a restart. Keys stay on
// the server: nothing here is ever sent to the browser.
const repoRoot = path.dirname(/* turbopackIgnore: true */ process.cwd());

function parse(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

export async function env(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  try {
    return parse(await readFile(/* turbopackIgnore: true */ path.join(repoRoot, ".env"), "utf8"))[name] || "";
  } catch {
    return "";
  }
}
