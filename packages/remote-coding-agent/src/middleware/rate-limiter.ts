/**
 * Per-user rate limiter using a sliding window counter.
 * Works across all channels — keyed by userId string.
 */

export class UserRateLimiter {
  private windows = new Map<string, number[]>();
  private maxPerMinute: number;

  constructor(maxPerMinute: number = 20) {
    this.maxPerMinute = maxPerMinute;
  }

  check(userId: string): boolean {
    const now = Date.now();
    const cutoff = now - 60_000;
    let ts = this.windows.get(userId) || [];
    ts = ts.filter((t) => t > cutoff);

    if (ts.length >= this.maxPerMinute) {
      this.windows.set(userId, ts);
      return false;
    }

    ts.push(now);
    this.windows.set(userId, ts);
    return true;
  }

  remaining(userId: string): number {
    const cutoff = Date.now() - 60_000;
    const ts = (this.windows.get(userId) || []).filter((t) => t > cutoff);
    return Math.max(0, this.maxPerMinute - ts.length);
  }

  clear(userId: string): void { this.windows.delete(userId); }
  clearAll(): void { this.windows.clear(); }
}
