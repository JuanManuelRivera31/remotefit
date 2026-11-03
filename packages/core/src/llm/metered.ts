import type { RateLimiter } from "./rate-limiter.js";
import {
  QuotaExhaustedError,
  type GenerateStructuredArgs,
  type GenerateStructuredResult,
  type LLMProvider,
} from "./types.js";

export interface MeteredProviderOptions {
  sleep: (ms: number) => Promise<void>;
  /** Called after each request is counted (e.g. to persist the daily usage or print the 80 % warning). */
  onRequest?: (limiter: RateLimiter) => void;
}

/**
 * Wraps a provider so that EVERY call (retries included) respects the RPM spacing and the daily limit.
 * When the local daily limit is reached it throws QuotaExhaustedError before touching the network.
 */
export class MeteredProvider implements LLMProvider {
  readonly name: string;

  constructor(
    private readonly inner: LLMProvider,
    private readonly limiter: RateLimiter,
    private readonly options: MeteredProviderOptions,
  ) {
    this.name = inner.name;
  }

  async generateStructured<T>(
    args: GenerateStructuredArgs<T>,
  ): Promise<GenerateStructuredResult<T>> {
    if (this.limiter.remainingToday <= 0) {
      throw new QuotaExhaustedError("local daily request limit reached");
    }
    const wait = this.limiter.msUntilNextSlot();
    if (wait > 0) await this.options.sleep(wait);
    this.limiter.record();
    this.options.onRequest?.(this.limiter);
    return this.inner.generateStructured(args);
  }
}
