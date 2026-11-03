import { z } from "zod";
import {
  OutputValidationError,
  type LLMProvider,
  type LLMUsage,
  type ThinkingLevel,
} from "../llm/types.js";
import { isQuoteInSource } from "./postprocess.js";
import { buildUserMessage, type PromptJob } from "./prompt.js";
import type { Eligibility } from "./schema.js";

/** Bump whenever the verifier text changes: it is part of its cache key. */
export const VERIFIER_PROMPT_VERSION = "verifier-v1";

export const VerifierSchema = z.object({
  confirmed: z.boolean(),
  /** Verbatim phrase of the posting that supports the answer (empty when not confirmed). */
  quote: z.string().max(160),
});
export type VerifierAnswer = z.infer<typeof VerifierSchema>;

export const VERIFIER_SYSTEM_PROMPT = `You are a strict second reviewer of a job-posting classifier. A first classifier decided that this posting is a REMOTE job that a person living in Colombia can apply to. You are given the posting and the first classifier's answer. Decide whether the posting itself EXPLICITLY supports that.

Answer confirmed = true ONLY if you can quote one verbatim phrase (from the title, the location field or the description, at most 160 characters) that shows BOTH: (1) the role is remote for this posting, and (2) people in Colombia may apply, because the text names Colombia, or Latin America / LATAM / the Americas, or says the role is open worldwide / from anywhere in the world.

Answer confirmed = false (and quote = "") when any of these holds:
- the support is only a list of countries or cities that does not include Colombia, or Colombia appears in a location segment that is not marked Remote while another segment is;
- the support is a generic phrase about the company or the work ("global team", "distributed", "remote-first", "can be executed globally") without saying who may apply;
- the role is hybrid, has fixed office days, or requires living in a city or country other than Colombia;
- the posting requires work authorization or residence in another country;
- you are not sure.

Output one JSON object {"confirmed": boolean, "quote": string} and nothing else.`;

export interface VerifierOptions {
  model: string;
  thinkingLevel?: ThinkingLevel;
  maxTokens?: number;
}

export interface VerifierOutcome {
  /** True only when the model confirmed AND its quote really appears in the posting text. */
  confirmed: boolean;
  quote: string;
  /** The model said yes but its quote is not in the posting: treated as not confirmed. */
  quoteUnverified: boolean;
  usage: LLMUsage;
}

/** The user message: the same public posting text as the classifier plus the first answer (no personal data). */
export function buildVerifierMessage(job: PromptJob, first: Eligibility): string {
  return [
    buildUserMessage(job),
    "",
    `FIRST CLASSIFIER ANSWER: label=${first.label}; countries=[${first.countries.join(",")}]; workModel=${first.workModel}; evidence=${JSON.stringify(first.evidence)}`,
  ].join("\n");
}

/**
 * Second opinion for a positive (applicable) classification. If the verifier does not confirm, the caller must treat
 * the posting as unclear. Quota and network errors propagate (the posting stays pending); an answer that never
 * validates counts as not confirmed.
 */
export async function verifyPositive(
  provider: LLMProvider,
  job: PromptJob,
  first: Eligibility,
  options: VerifierOptions,
): Promise<VerifierOutcome> {
  const user = buildVerifierMessage(job, first);
  try {
    const response = await provider.generateStructured({
      model: options.model,
      system: VERIFIER_SYSTEM_PROMPT,
      user,
      schema: VerifierSchema,
      schemaName: "verification",
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
    });
    const { confirmed, quote } = response.data;
    // The quote must come from the posting itself, not from the first classifier's answer appended to the message.
    const quoteOk = quote.trim() !== "" && isQuoteInSource(quote, buildUserMessage(job));
    return {
      confirmed: confirmed && quoteOk,
      quote: quoteOk ? quote.trim() : "",
      quoteUnverified: confirmed && !quoteOk,
      usage: response.usage,
    };
  } catch (error) {
    if (!(error instanceof OutputValidationError)) throw error;
    return {
      confirmed: false,
      quote: "",
      quoteUnverified: false,
      usage: error.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        equivalentCostUsd: 0,
      },
    };
  }
}
