// Screenshots of the main views at phone (375 px) and tablet (768 px) widths, for review and the README.
// Needs the app running: `npm run dev` (API mode) or a static build served with `vite preview` (static mode,
// RF_WEB_URL=http://localhost:4173/remotefit). Usage: node scripts/screenshots.mjs [outDir]   (default docs/capturas)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.RF_WEB_URL ?? "http://localhost:5173";
const outDir = process.argv[2] ?? "docs/capturas";
const MAX_HEIGHT = 2400; // long lists are clipped: the review is about layout, not every card

// Pick a vacancy with many postings and a single posting, from the API or, on the static site, from the public JSON.
async function pick() {
  const api = await fetch(`${BASE}/api/jobs?country=CO`).catch(() => null);
  if (api?.ok && (api.headers.get("content-type") ?? "").includes("json")) {
    const list = await api.json();
    return {
      grouped: list.items.find((job) => job.siblingCount > 3) ?? list.items[0],
      single: list.items.find((job) => job.siblingCount === 0) ?? list.items[0],
    };
  }
  const data = await (await fetch(`${BASE}/data/jobs.json`)).json();
  const visible = data.jobs.filter((j) => ["latam_eligible", "worldwide"].includes(j.result.label));
  const sizes = new Map();
  for (const j of data.jobs) if (j.siblingGroup) sizes.set(j.siblingGroup, (sizes.get(j.siblingGroup) ?? 0) + 1);
  return {
    grouped: visible.find((j) => (sizes.get(j.siblingGroup) ?? 0) > 3) ?? visible[0],
    single: visible.find((j) => !j.siblingGroup || sizes.get(j.siblingGroup) === 1) ?? visible[0],
  };
}
const { grouped, single } = await pick();
if (!grouped || !single) throw new Error("No postings to show: run ingest/prefilter/classify first.");

const views = [
  { name: "lista", path: "/" },
  // Phones fold the filters behind a button; this view opens it.
  { name: "lista-filtros-abiertos", path: "/?nivel=senior", click: "button[aria-controls=filtros]", only: 375 },
  { name: "lista-sin-medir-y-sin-confirmar", path: "/?pais=MX&sin_confirmar=1" },
  { name: "detalle-vacante-con-hermanas", path: `/ofertas/${grouped.id}` },
  { name: "detalle-oferta", path: `/ofertas/${single.id}` },
  { name: "metodo", path: "/metodo" },
];
const widths = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const viewport of widths) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: "es-CO" });
    for (const view of views) {
      if (view.only && view.only !== viewport.width) continue;
      await page.goto(`${BASE}${view.path}`, { waitUntil: "networkidle" });
      if (view.click) await page.click(view.click);
      await page.waitForSelector("main h1, main article, main [role=alert], main p");
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > viewport.width) {
        console.warn(`  ${view.name} @${viewport.width}: horizontal overflow (${scrollWidth}px)`);
      }
      const file = `${outDir}/${view.name}-${viewport.width}.png`;
      await page.screenshot({
        path: file,
        clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, MAX_HEIGHT) },
      });
      console.log(file);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
