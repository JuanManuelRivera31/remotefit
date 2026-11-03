import { z } from "zod";

const modelLimitsSchema = z.object({
  rpm: z.number().int().positive(),
  tpm: z.number().int().positive(),
  rpd: z.number().int().positive(),
  /** Lowest thinking level the model accepts. */
  thinkingLevel: z.enum(["MINIMAL", "LOW", "MEDIUM", "HIGH"]),
  notes: z.string().optional(),
});

/** Shape of `data/llm-limits.json`: limits live in configuration, never in code (ADR 0005). */
export const llmLimitsSchema = z.object({
  source: z.string().min(1),
  verifiedAt: z.string().nullable(),
  /** Fraction kept as headroom below each limit (0.2 = use at most 80 %). */
  safetyMargin: z.number().min(0).max(0.9),
  models: z.record(z.string(), modelLimitsSchema),
});
export type LlmLimitsConfig = z.infer<typeof llmLimitsSchema>;
export type ModelLimits = z.infer<typeof modelLimitsSchema>;

export function parseLimits(json: unknown): LlmLimitsConfig {
  return llmLimitsSchema.parse(json);
}

export interface EffectiveLimits {
  rpm: number;
  tpm: number;
  rpd: number;
  thinkingLevel: ModelLimits["thinkingLevel"];
}

/** Limits to respect: the panel's numbers reduced by the safety margin (never below 1). */
export function effectiveLimits(config: LlmLimitsConfig, model: string): EffectiveLimits {
  const limits = config.models[model];
  if (!limits) {
    throw new Error(
      `Model "${model}" is not in data/llm-limits.json (known: ${Object.keys(config.models).join(", ")}).`,
    );
  }
  const keep = 1 - config.safetyMargin;
  const reduce = (value: number): number => Math.max(1, Math.floor(value * keep));
  return {
    rpm: reduce(limits.rpm),
    tpm: reduce(limits.tpm),
    rpd: reduce(limits.rpd),
    thinkingLevel: limits.thinkingLevel,
  };
}
