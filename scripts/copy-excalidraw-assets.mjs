// Self-host Excalidraw's fonts so boards don't depend on a third-party CDN.
// Runs before `dev` and `build`; output is git-ignored.
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// Resolves to .../@excalidraw/excalidraw/dist/prod/index.js
const src = join(dirname(require.resolve("@excalidraw/excalidraw")), "fonts");
const dest = join(process.cwd(), "public", "fonts");

if (!existsSync(src)) {
  console.warn(`[sabboura] Excalidraw fonts not found at ${src}; falling back to the CDN.`);
} else {
  cpSync(src, dest, { recursive: true });
  console.log("[sabboura] Copied Excalidraw fonts to public/fonts");
}
