// GitHub Pages serves 404.html for unknown paths. Copying index.html there lets deep links (/ofertas/123, /metodo)
// load the single-page app, which then routes on the client. Usage: node scripts/spa-fallback.mjs <dist dir>
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "apps/web/dist";
copyFileSync(join(dist, "index.html"), join(dist, "404.html"));
console.log(`spa fallback: ${join(dist, "404.html")}`);
