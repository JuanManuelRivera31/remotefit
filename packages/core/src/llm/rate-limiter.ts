/** Day of the provider's daily quota (RPD resets at midnight Pacific time), as YYYY-MM-DD. */
export function quotaDay(now: Date): string {
  // "en-CA" formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface RateLimiterOptions {
  /** Requests per minute to respect (already reduced by the safety margin). */
  rpm: number;
  /** Requests per quota day to respect. */
  rpd: number;
  /** Requests already made today, restored from persisted usage so the count survives between runs. */
  usedToday?: number;
  /** Quota day that `usedToday` refers to; ignored if it is not today. */
  usedDay?: string;
  now?: () => Date;
}

/**
 * Pure pacing logic (injected clock, no sleeping): minimum spacing derived from RPM and a per-quota-day request counter.
 * Retries are requests too, so callers must `record()` every call. TPM is not enforced here: with the input cap of the
 * classifier (about 5k tokens) the RPM spacing keeps usage far below the TPM limits of the configured models.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private readonly rpd: number;
  private readonly now: () => Date;
  private day: string;
  private used: number;
  private lastRequestAt: number | null = null;
  private warned = false;

  constructor(options: RateLimiterOptions) {
    this.minIntervalMs = Math.ceil(60_000 / options.rpm);
    this.rpd = options.rpd;
    this.now = options.now ?? (() => new Date());
    this.day = quotaDay(this.now());
    this.used = options.usedDay === this.day ? (options.usedToday ?? 0) : 0;
  }

  private rollDay(): void {
    const today = quotaDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
      this.warned = false;
    }
  }

  get quotaDayKey(): string {
    this.rollDay();
    return this.day;
  }

  get usedTodayCount(): number {
    this.rollDay();
    return this.used;
  }

  get remainingToday(): number {
    this.rollDay();
    return Math.max(0, this.rpd - this.used);
  }

  /** Milliseconds to wait before the next request respects the RPM spacing (0 = go now). */
  msUntilNextSlot(): number {
    if (this.lastRequestAt === null) return 0;
    return Math.max(0, this.lastRequestAt + this.minIntervalMs - this.now().getTime());
  }

  /** Raises the local count to what a shared ledger says was used today (other processes count too). */
  syncUsedToday(sharedCount: number): void {
    this.rollDay();
    this.used = Math.max(this.used, sharedCount);
  }

  /** Count one request (retries included). */
  record(): void {
    this.rollDay();
    this.used += 1;
    this.lastRequestAt = this.now().getTime();
  }

  /** True the first time usage crosses 80 % of the daily limit, so the caller can warn once. */
  consumeWarning(): boolean {
    this.rollDay();
    if (!this.warned && this.used >= Math.ceil(this.rpd * 0.8)) {
      this.warned = true;
      return true;
    }
    return false;
  }
}
