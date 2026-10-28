import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(appRoot);

// The app's Markdown is in content/, inside nextjs/. It runs locally and reads
// content/ at request time; the tracing include below brings it along if the app is ever deployed.
export default {
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.local"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/*": ["./content/**/*"],
  },
};
