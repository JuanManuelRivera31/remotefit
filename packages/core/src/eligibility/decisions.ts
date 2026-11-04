// Which classifier combinations the owner accepted on a frozen test split (ADR 0004 / ADR 0005). Browser-safe.
// The web shows the "version not accepted" banner while the combination in use has no entry here; adding the entry
// (after the owner's decision) removes the banner without touching the UI.

/** Model used by `npm run classify`, `npm run eval` and the API unless RF_LLM_MODEL_CLASSIFY overrides it. */
export const DEFAULT_CLASSIFY_MODEL = "gemini-3.5-flash-lite";

export interface ClassifierKey {
  promptVersion: string;
  postprocessVersion: string;
  model: string;
}

export interface ClassifierDecision extends ClassifierKey {
  /** `accepted`: met precision >= 95 % and recall >= 80 %. `accepted_with_gap`: did not, accepted under ADR 0005. */
  state: "accepted" | "accepted_with_gap";
  decidedAt: string;
  testSet: string;
  /** Point values on the test split, for Colombia. */
  precision: number;
  recall: number;
  /** Wilson 95 % intervals. */
  precisionCi: [number, number];
  recallCi: [number, number];
  /** Countries the measurement covers (the test labels are for Colombia only). */
  measuredCountries: string[];
}

export const CLASSIFIER_DECISIONS: readonly ClassifierDecision[] = [];

export type AcceptanceState = ClassifierDecision["state"] | "not_accepted";

export function decisionFor(
  key: ClassifierKey,
  decisions: readonly ClassifierDecision[] = CLASSIFIER_DECISIONS,
): ClassifierDecision | null {
  return (
    decisions.find(
      (d) =>
        d.promptVersion === key.promptVersion &&
        d.postprocessVersion === key.postprocessVersion &&
        d.model === key.model,
    ) ?? null
  );
}
