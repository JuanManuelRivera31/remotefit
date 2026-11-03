import { countriesMentioned } from "../src/eligibility/postprocess.js";

/** A posting of the database pool. Only metadata used for SELECTION; labels are decided later by reading the body. */
export interface PoolJob {
  id: string; // source:board:externalId
  company: string;
  title: string;
  locationRaw: string;
  workplaceType: string | null;
  siblingGroup: string | null;
  /** Company + normalized title: variants of one vacancy that the sibling group did not join (other requisition ids). */
  titleKey: string;
}

export type Stratum =
  | "candidate" // likely applicable from the location field alone (Colombia / LATAM / region / worldwide, not hybrid)
  | "negative_us"
  | "negative_other_country"
  | "negative_hybrid"
  | "negative_other";

export interface SelectOptions {
  seed: number;
  maxPerCompany: number;
  maxPerGroup: number;
  /** Total number of negatives to aim for (they only fill the room left under the per-company cap). */
  targetNegatives: number;
  /** Ids already in the eval (any split) and every sibling group they belong to. */
  excludeIds: ReadonlySet<string>;
  excludeGroups: ReadonlySet<string>;
}

export interface Selected extends PoolJob {
  stratum: Stratum;
}

export interface Selection {
  selected: Selected[];
  /** Siblings left out of the eval altogether so that no variant of a selected vacancy can leak elsewhere. */
  leftOut: PoolJob[];
}

/** Deterministic PRNG (mulberry32), so the selection is reproducible from the seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const REGION_OR_CO = /colombia|bogot|latam|latin america|americas|\bamer\b|worldwide|anywhere/i;
const HYBRID_LOCATION = /^hybrid|office -|office based/i;

/** Heuristic stratum from metadata only (never from a model). */
export function stratumOf(job: PoolJob): Stratum {
  const hybrid =
    job.workplaceType === "hybrid" ||
    job.workplaceType === "onsite" ||
    HYBRID_LOCATION.test(job.locationRaw);
  if (hybrid) return "negative_hybrid";
  if (REGION_OR_CO.test(job.locationRaw)) return "candidate";
  const countries = countriesMentioned(job.locationRaw);
  if (countries.length === 1 && countries[0] === "US") return "negative_us";
  if (
    /united states|\bUS\b|usa|new york|san francisco|seattle|austin|boston/i.test(job.locationRaw)
  ) {
    return "negative_us";
  }
  if (countries.length > 0) return "negative_other_country";
  return "negative_other";
}

/**
 * Picks up to `maxPerGroup` members of a sibling group, preferring different countries; the rest are left out.
 * A posting without sibling group is its own group.
 */
function pickFromGroup(
  members: readonly PoolJob[],
  maxPerGroup: number,
  random: () => number,
): { kept: PoolJob[]; leftOut: PoolJob[] } {
  const order = shuffle(members, random);
  const kept: PoolJob[] = [];
  const seenCountries = new Set<string>();
  for (const job of order) {
    if (kept.length >= maxPerGroup) break;
    const key = countriesMentioned(job.locationRaw).sort().join(",") || job.locationRaw;
    if (!seenCountries.has(key)) {
      seenCountries.add(key);
      kept.push(job);
    }
  }
  for (const job of order) {
    if (kept.length >= maxPerGroup) break;
    if (!kept.includes(job)) kept.push(job);
  }
  return { kept, leftOut: order.filter((job) => !kept.includes(job)) };
}

/**
 * test-v2 selection (ADR 0004, section 6): never-seen postings only, at most `maxPerGroup` per sibling group and
 * `maxPerCompany` per company; likely-applicable candidates first, then negatives spread over strata and companies.
 */
export function selectTestSet(pool: readonly PoolJob[], options: SelectOptions): Selection {
  const random = prng(options.seed);
  const eligible = pool.filter(
    (job) =>
      !options.excludeIds.has(job.id) &&
      !(job.siblingGroup && options.excludeGroups.has(job.siblingGroup)),
  );

  const groups = new Map<string, PoolJob[]>();
  for (const job of eligible) {
    const key = job.siblingGroup ?? `single:${job.id}`;
    (groups.get(key) ?? groups.set(key, []).get(key))?.push(job);
  }

  // Pass 1: the sibling groups of the database. Pass 2: the same vacancy by title key, for variants the group missed.
  const afterGroups: PoolJob[] = [];
  const leftOut: PoolJob[] = [];
  for (const key of [...groups.keys()].sort()) {
    const picked = pickFromGroup(groups.get(key) ?? [], options.maxPerGroup, random);
    afterGroups.push(...picked.kept);
    leftOut.push(...picked.leftOut);
  }
  const byTitle = new Map<string, PoolJob[]>();
  for (const job of afterGroups) {
    (byTitle.get(job.titleKey) ?? byTitle.set(job.titleKey, []).get(job.titleKey))?.push(job);
  }
  const kept: PoolJob[] = [];
  for (const key of [...byTitle.keys()].sort()) {
    const picked = pickFromGroup(byTitle.get(key) ?? [], options.maxPerGroup, random);
    kept.push(...picked.kept);
    leftOut.push(...picked.leftOut);
  }

  const perCompany = new Map<string, number>();
  const room = (company: string): number => options.maxPerCompany - (perCompany.get(company) ?? 0);
  const take = (job: Selected, into: Selected[]): void => {
    into.push(job);
    perCompany.set(job.company, (perCompany.get(job.company) ?? 0) + 1);
  };

  const withStratum: Selected[] = shuffle(kept, random).map((job) => ({
    ...job,
    stratum: stratumOf(job),
  }));
  const selected: Selected[] = [];

  // 1. Candidates first, up to the cap of each company.
  for (const job of withStratum.filter((item) => item.stratum === "candidate")) {
    if (room(job.company) > 0) take(job, selected);
  }

  // 2. Negatives: round-robin over strata so every kind of hard negative shows up, respecting the company cap.
  const strata: Stratum[] = [
    "negative_us",
    "negative_other_country",
    "negative_hybrid",
    "negative_other",
  ];
  const queues = new Map<Stratum, Selected[]>(
    strata.map((stratum) => [stratum, withStratum.filter((item) => item.stratum === stratum)]),
  );
  let negatives = 0;
  let progressed = true;
  while (negatives < options.targetNegatives && progressed) {
    progressed = false;
    for (const stratum of strata) {
      if (negatives >= options.targetNegatives) break;
      const queue = queues.get(stratum) ?? [];
      while (queue.length > 0) {
        const job = queue.shift() as Selected;
        if (room(job.company) > 0) {
          take(job, selected);
          negatives += 1;
          progressed = true;
          break;
        }
      }
    }
  }

  const chosen = new Set(selected.map((job) => job.id));
  const notChosen = withStratum.filter((job) => !chosen.has(job.id));
  // Postings that were not chosen stay out of the eval too only if they are variants of a chosen vacancy.
  const chosenGroups = new Set(
    selected.map((job) => job.siblingGroup).filter((g): g is string => g !== null),
  );
  const chosenTitles = new Set(selected.map((job) => job.titleKey));
  const sameVacancy = (job: PoolJob): boolean =>
    chosenTitles.has(job.titleKey) ||
    (job.siblingGroup !== null && chosenGroups.has(job.siblingGroup));
  return {
    selected,
    leftOut: [...leftOut, ...notChosen].filter(sameVacancy),
  };
}
