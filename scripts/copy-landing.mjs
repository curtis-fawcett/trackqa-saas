// Copies landing.html next to the SPA bundle (frontend/dist/landing.html).
//
// Why: the root route serves the landing page with res.sendFile(), which Vercel's
// file tracing cannot see (the path is dynamic), while frontend/dist IS shipped
// inside the deployed function bundle. Keeping the two files together means the
// landing page is read from the location we know exists at runtime.
//
// Best effort by design: a failure here must never break the install or build,
// because the root route also falls back to the repo-root copy and to the SPA
// shell (see sendFileSafe in src/index.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "landing.html");
const targetDir = path.join(root, "frontend", "dist");
const target = path.join(targetDir, "landing.html");

try {
  if (!fs.existsSync(source)) {
    console.warn(`[copy-landing] ${source} not found; skipping`);
  } else if (!fs.existsSync(targetDir)) {
    console.warn(`[copy-landing] ${targetDir} not found; skipping`);
  } else {
    fs.copyFileSync(source, target);
    console.log(
      `[copy-landing] ${path.relative(root, source)} -> ${path.relative(root, target)} (${fs.statSync(target).size} bytes)`
    );
  }
} catch (err) {
  console.warn(`[copy-landing] skipped: ${err.message}`);
}

process.exit(0);
