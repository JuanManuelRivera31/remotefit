import type { SharedQuotaCounter } from "./quota-ledger.js";
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
  /**
   * The shared per-model counter (eval and classify use the same one). Read before each request so requests made by
   * another process count against the limit, and written after each request is counted.
   */
  shared?: SharedQuotaCounter;
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
    const shared = this.options.shared;
    if (shared) this.limiter.syncUsedToday(shared.used(this.limiter.quotaDayKey));
    if (this.limiter.remainingToday <= 0) {
      throw new QuotaExhaustedError("local daily request limit reached");
    }
    const wait = this.limiter.msUntilNextSlot();
    if (wait > 0) await this.options.sleep(wait);
    this.limiter.record();
    shared?.record(this.limiter.quotaDayKey);
    this.options.onRequest?.(this.limiter);
    return this.inner.generateStructured(args);
  }
}
