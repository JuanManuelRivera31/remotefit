// One-off, 2026-11-03. Owner decisions made BEFORE any model run on test-v2, plus rule 6 of the ADR 0004 labelling guide
// ("remote-first" with periodic travel is remote; hybrid = regular weekly presence). Every change keeps the previous state
// (relabeledFrom for the first change, relabelHistory for later ones).
import { readFileSync, writeFileSync } from "node:fs";
const P = "packages/core/evals/eligibility/cases.json";
const raw = readFileSync(P, "utf8");
const crlf = raw.includes("\r\n");
const data = JSON.parse(raw);
const date = "2026-11-03";
const snap = (c) => ({ label: c.label, workModel: c.workModel, countries: c.countries, workModelConflict: c.workModelConflict ?? false, evidence: c.evidence ?? null, travelRequirement: c.travelRequirement ?? null, labelStatus: c.labelStatus });

const REMOTE_FIRST = "This is a remote-first role: you'll work from home day to day.";
const relabels = [
  // --- Owner decisions on test-v2 (pre-run) ---
  ["ashby:addi:9438857e-28ed-41b7-848f-ad092ca63c5b", "owner_rule6_travel_is_remote", { label: "country_specific", countries: ["CO"], workModel: "remote", workModelConflict: false, travelRequirement: "In-person weeks in Bogota, paid by the company", evidence: "Location: Remote-first, with in-person weeks in Bogotá, fully paid by Addi" }],
  ["ashby:supabase:66bab062-b769-43cf-ac3c-a2630257624c", "owner_d5_americas_region", { label: "latam_eligible", countries: [], workModel: "remote", workModelConflict: false, evidence: "This role will support the East Coast region across the Americas." }],
  ["greenhouse:turing:6225409004", "owner_pattern3_global_remote", { label: "worldwide", countries: [], workModel: "remote", workModelConflict: false, evidence: "Global - Remote" }],
  // --- Rule 6 applied to the rest of dev and test-v2 ---
  ["greenhouse:sezzle:7504352003", "rule6_onsite_when_required_is_not_weekly", { label: "country_specific", countries: ["CO"], workModel: "remote", workModelConflict: false, travelRequirement: "Onsite in Bogota when required", evidence: "Location: Based in Bogotá, Colombia; able to work both remotely and onsite when required." }],
  ...["greenhouse:clara:5204916007", "greenhouse:clara:5204918007", "greenhouse:clara:5257213007"].map((id) => [id, "rule6_remote_first_periodic_in_person", { label: "country_specific", countries: ["CO", "MX", "BR"], workModel: "remote", workModelConflict: false, travelRequirement: "In-person ramp-up, team moments, events and customer visits through the year", evidence: REMOTE_FIRST }]),
];
for (const [id, rule, patch] of relabels) {
  const c = data.cases.find((x) => x.id === id);
  if (!c) throw new Error("missing " + id);
  const before = snap(c);
  if (c.relabeledFrom) (c.relabelHistory ??= []).push({ ...before, relabelRule: c.relabelRule, relabeledAt: c.relabeledAt });
  else c.relabeledFrom = before;
  Object.assign(c, patch, { relabelRule: rule, relabeledAt: date, labelStatus: c.split === "test" ? "owner_decided_pre_run" : "owner_rules_applied" });
}
// Sezzle 8012023003 stays unclear: owner confirmation recorded, no change of label.
const keep = data.cases.find((x) => x.id === "greenhouse:sezzle:8012023003");
keep.ownerConfirmedAt = date;
// Evidence made literal (label unchanged): the three Clara titles abbreviated with "...".
for (const [id, title] of [
  ["greenhouse:clara:5208457007", "Tech Lead — Users & Auth (Líder Técnico/a - Usuarios y Autenticación) - Hybrid"],
  ["greenhouse:clara:5208456007", "Tech Lead — Users & Auth (Líder Técnico/a - Usuarios y Autenticación) - Mexico City (Hybrid)"],
  ["greenhouse:clara:5208458007", "Tech Lead — Users & Auth (Liderança Técnica - Usuários e Autenticação) - São Paulo (Hybrid)"],
]) {
  const c = data.cases.find((x) => x.id === id);
  if (title) { c.evidence = title; c.evidenceFixedAt = date; }
}
data.testSet.preRunChanges = {
  date,
  note: "Made before any model run on test-v2 (owner decisions and rule 6 of the ADR 0004 labelling guide); each case keeps relabeledFrom.",
  changed: relabels.filter(([id]) => data.cases.find((x) => x.id === id).split === "test").map(([id]) => id),
  confirmedUnchanged: ["greenhouse:sezzle:8012023003"],
};
writeFileSync(P, JSON.stringify(data, null, 2).replace(/\n/g, crlf ? "\r\n" : "\n") + (raw.endsWith("\n") ? (crlf ? "\r\n" : "\n") : ""));
console.log("relabeled", relabels.length);
