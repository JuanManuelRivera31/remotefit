// One-off: applies the owner's decisions on the 9 doubtful development cases (docs/progreso.md, 2026-11-03).
// Every change keeps relabeledFrom / relabelRule / relabeledAt in cases.json. Dev split only.
import { readFileSync, writeFileSync } from "node:fs";
const P = "packages/core/evals/eligibility/cases.json";
const raw = readFileSync(P, "utf8");
const data = JSON.parse(raw);
const date = "2026-11-03";
const snap = (c) => ({ label: c.label, workModel: c.workModel, countries: c.countries, workModelConflict: c.workModelConflict ?? false, evidence: c.evidence ?? null, labelStatus: c.labelStatus });
const changes = [
  ["greenhouse:sezzle:8010090003", "guide_p3_timezone_not_country", { label: "latam_eligible", countries: [], workModel: "remote", workModelConflict: false,
    evidence: "Location \"Mexico, Remote | Latin America [Remote] | US Remote\"; \"Central time zone\" alone does not restrict to Mexico (D5); neither title nor body names Mexico as a requirement." }],
  ["greenhouse:sezzle:7906563003", "guide_p3_country_list", { label: "country_specific", countries: ["PE", "CO"], workModel: "remote", workModelConflict: false,
    evidence: "Location \"Peru | Bogota, Colombia\" bundles two sibling postings; title and body name no country as a requirement; a country list is not a region, so both countries stay." }],
  ["ashby:pinecone:edf2a2a5-64e2-45b8-9f2e-4f354af350b8", "owner_decision_conflict", { label: "us_only", countries: [], workModel: "remote", workModelConflict: true,
    evidence: "Location \"New York City | US Remote\" (US-only) while the ATS workplaceType says hybrid." }],
  ["greenhouse:clara:5204916007", "rule5_remote_first_vs_hybrid_city", { label: "onsite_or_hybrid", countries: ["CO", "MX", "BR"], workModel: "hybrid", workModelConflict: true,
    evidence: "\"remote-first role\" vs company \"committed to hybrid work\"; the role has an assigned city (Mexico City) so the conservative rule gives onsite_or_hybrid." }],
  ["greenhouse:clara:5204918007", "rule5_remote_first_vs_hybrid_city", { label: "onsite_or_hybrid", countries: ["CO", "MX", "BR"], workModel: "hybrid", workModelConflict: true,
    evidence: "\"remote-first role\" vs \"Clara is committed to hybrid work\"; the role has an assigned city (Sao Paulo) so the conservative rule gives onsite_or_hybrid." }],
  ["greenhouse:clara:5257213007", "rule5_remote_first_vs_hybrid_city", { label: "onsite_or_hybrid", countries: ["CO", "MX", "BR"], workModel: "hybrid", workModelConflict: true,
    evidence: "Title \"Remote First\" vs \"Clara is committed to hybrid work\"; the role has assigned cities (Bogota, Mexico City, Sao Paulo) so the conservative rule gives onsite_or_hybrid." }],
  ["lever:ciandt:a75a23c9-bc2b-481c-9022-e83094964de7", "metadata_when_body_silent", { label: "country_specific", countries: ["BR"], workModel: "remote", workModelConflict: false,
    evidence: "Title and location say Brazil; ATS workplaceType remote; the Campinas presence rule applies only to residents of that metro area." }],
];
for (const [id, rule, patch] of changes) {
  const c = data.cases.find((x) => x.id === id);
  if (!c) throw new Error("missing " + id);
  const before = snap(c);
  Object.assign(c, patch, { relabeledFrom: c.relabeledFrom ?? before, relabelRule: rule, relabeledAt: date, labelStatus: "owner_rules_applied" });
}
data.devLabelRevision.revisions.push({
  date,
  decidedBy: "owner",
  scope: "development split (160 cases); test-v2 untouched",
  rules: [
    "ADR 0004 guide rule 5: on doubt or contradiction the conservative (non-applicable) label wins.",
    "A time zone alone (\"Central time zone\") does not restrict to a country (D5).",
    "\"remote-first\" vs \"committed to hybrid work\": onsite_or_hybrid if the role has an assigned city/office, otherwise unclear. Never applicable.",
  ],
  changedCases: changes.length,
  keptAsIs: ["greenhouse:wizeline:7264950 (unclear)", "greenhouse:celonis:8002490003 (onsite_or_hybrid)", "ashby:perplexity:be94e89b-89d5-4f2a-a58b-7929c8d97f92 (onsite_or_hybrid)", "greenhouse:sezzle:7984978003 (latam_eligible by pattern 3, accepted by the owner)"],
});
writeFileSync(P, JSON.stringify(data, null, 2).replace(/\n/g, raw.includes("\r\n") ? "\r\n" : "\n") + (raw.endsWith("\n") ? (raw.includes("\r\n") ? "\r\n" : "\n") : ""));
console.log("changed", changes.length);
