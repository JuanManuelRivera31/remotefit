// Replaces the free text of the connector fixtures (descriptions, lists, openings) with synthetic text, keeping the
// real response SHAPE (field names, ids, titles, locations, dates, metadata) that the connectors were written from.
// Why: ADR 0002 forbids redistributing posting text publicly, and the repo is going public. Deterministic and
// idempotent: run it again and nothing changes.
// Usage: node scripts/synthesize-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";

const FIXTURES = [
  { path: "packages/core/fixtures/greenhouse/sezzle.json", company: "Sezzle" },
  { path: "packages/core/fixtures/greenhouse/sezzle-siblings.json", company: "Sezzle" },
  { path: "packages/core/fixtures/lever/deuna.json", company: "DEUNA" },
  { path: "packages/core/fixtures/ashby/addi.json", company: "Addi" },
];

/** Free-text fields of the three ATS responses. Anything else this long is treated as free text too. */
const TEXT_KEYS = new Set([
  "content",
  "description",
  "descriptionHtml",
  "descriptionPlain",
  "descriptionBody",
  "descriptionBodyPlain",
  "additional",
  "additionalPlain",
  "opening",
  "openingPlain",
]);
const LONG = 200;
const MARK = "Synthetic fixture text";

function synthetic(company, n, format) {
  const paragraphs = [
    `About ${company}`,
    `${MARK} #${n}. This paragraph stands in for the original posting text, which is not kept in the repository (ADR 0002).`,
    "What you will do: build and maintain services, review code with the team and improve reliability.",
    "What we look for: experience with modern web stacks, clear written English and ownership of results.",
  ];
  const items = ["Ship features end to end", "Write tests next to the code", "Share knowledge in reviews"];
  if (format === "plain") return `${paragraphs.join("\n\n")}\n\n${items.map((i) => `- ${i}`).join("\n")}`;
  const html = `${paragraphs.map((p, i) => (i === 0 ? `<p><strong>${p}</strong></p>` : `<p>${p}</p>`)).join("")}<ul>${items
    .map((i) => `<li>${i}</li>`)
    .join("")}</ul>`;
  if (format === "escaped") return html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return html;
}

const formatOf = (text) => (/&lt;[a-z]/i.test(text) ? "escaped" : /<[a-z][^>]*>/i.test(text) ? "html" : "plain");

for (const { path, company } of FIXTURES) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  let n = 0;
  let replaced = 0;
  const walk = (value, key) => {
    if (typeof value === "string") {
      const isText = (TEXT_KEYS.has(key) && value.length > 40) || value.length > LONG;
      if (!isText || value.includes(MARK)) return value;
      n += 1;
      replaced += 1;
      return synthetic(company, n, formatOf(value));
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    }
    return value;
  };
  const out = walk(data, "");
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${path}: ${replaced} text fields replaced`);
}
