export interface ModelPrice {
  /** USD per 1M input tokens (text). */
  inputPerMTokUsd: number;
  /** USD per 1M output tokens, thinking included. */
  outputPerMTokUsd: number;
}

/** List prices of the paid Standard tier, read from Google's pricing page on 2026-11-02. Used only as "equivalent cost". */
export const PRICING_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing (read 2026-11-02)";

const FLASH_PROMO_ENDS = new Date("2027-01-01T00:00:00Z");

/** Equivalent (paid) price of a model at a given date; throws for an unknown model instead of silently using 0. */
export function priceFor(model: string, now: Date = new Date()): ModelPrice {
  switch (model) {
    case "gemini-3.5-flash-lite":
      return { inputPerMTokUsd: 0.3, outputPerMTokUsd: 2.5 };
    case "gemini-3.1-flash-lite":
      return { inputPerMTokUsd: 0.25, outputPerMTokUsd: 1.5 };
    case "gemini-3.6-flash":
    case "gemini-3.8-flash":
      // Introductory price until 2026-12-31, doubled from 2027-01-01.
      return now < FLASH_PROMO_ENDS
        ? { inputPerMTokUsd: 0.75, outputPerMTokUsd: 3.75 }
        : { inputPerMTokUsd: 1.5, outputPerMTokUsd: 7.5 };
    default:
      throw new Error(`No equivalent price known for model "${model}"; add it to llm/pricing.ts.`);
  }
}

export function equivalentCostUsd(
  model: string,
  tokens: { inputTokens: number; outputTokens: number; thinkingTokens: number },
  now: Date = new Date(),
): number {
  const price = priceFor(model, now);
  return (
    (tokens.inputTokens * price.inputPerMTokUsd +
      (tokens.outputTokens + tokens.thinkingTokens) * price.outputPerMTokUsd) /
    1_000_000
  );
}
