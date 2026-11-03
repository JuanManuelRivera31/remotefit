import { z } from "zod";
import {
  OutputValidationError,
  type GenerateStructuredArgs,
  type GenerateStructuredResult,
  type LLMProvider,
  type LLMUsage,
} from "./types.js";

export type FakeStep =
  | { data: unknown; usage?: Partial<LLMUsage> }
  | Error
  | ((
      args: GenerateStructuredArgs<unknown>,
    ) => { data: unknown; usage?: Partial<LLMUsage> } | Error);

const DEFAULT_USAGE: LLMUsage = {
  inputTokens: 1000,
  outputTokens: 150,
  thinkingTokens: 0,
  equivalentCostUsd: 0.0005,
};

/**
 * Scripted provider for tests: each call consumes the next step (a JSON answer or an error to throw).
 * Answers go through the caller's Zod schema, exactly like the real provider, so invalid JSON becomes an
 * OutputValidationError. Never touches the network.
 */
export class FakeLLMProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: GenerateStructuredArgs<unknown>[] = [];
  private index = 0;

  constructor(private readonly steps: readonly FakeStep[]) {}

  get callCount(): number {
    return this.calls.length;
  }

  async generateStructured<T>(
    args: GenerateStructuredArgs<T>,
  ): Promise<GenerateStructuredResult<T>> {
    this.calls.push(args as GenerateStructuredArgs<unknown>);
    const raw = this.steps[this.index];
    this.index += 1;
    if (raw === undefined) throw new Error("FakeLLMProvider ran out of scripted steps.");
    const step = typeof raw === "function" ? raw(args as GenerateStructuredArgs<unknown>) : raw;
    if (step instanceof Error) throw step;
    const usage: LLMUsage = { ...DEFAULT_USAGE, ...step.usage };
    const parsed = args.schema.safeParse(step.data);
    if (!parsed.success) {
      throw new OutputValidationError(
        z.prettifyError(parsed.error).slice(0, 600),
        "invalid",
        usage,
      );
    }
    return { data: parsed.data, usage, model: args.model };
  }
}
