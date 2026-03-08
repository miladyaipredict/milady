import type { ExposureSnapshot } from "./types.js";

/**
 * In-memory exposure tracker. Enforces per-trade and total limits.
 * Resets on process restart (safety guardrail, not accounting system).
 */
class ExposureTracker {
  private totalExposureUsd = 0;
  private positionCount = 0;
  private maxSingleTradeUsd: number;
  private maxTotalExposureUsd: number;

  constructor(maxSingle = 10, maxTotal = 50) {
    this.maxSingleTradeUsd = maxSingle;
    this.maxTotalExposureUsd = maxTotal;
  }

  configure(maxSingle: number, maxTotal: number): void {
    this.maxSingleTradeUsd = maxSingle;
    this.maxTotalExposureUsd = maxTotal;
  }

  canTrade(amountUsd: number): { allowed: boolean; reason?: string } {
    if (amountUsd <= 0) {
      return { allowed: false, reason: "Amount must be positive" };
    }
    if (amountUsd > this.maxSingleTradeUsd) {
      return {
        allowed: false,
        reason: `Amount $${amountUsd} exceeds single-trade limit of $${this.maxSingleTradeUsd}`,
      };
    }
    if (this.totalExposureUsd + amountUsd > this.maxTotalExposureUsd) {
      return {
        allowed: false,
        reason: `Would exceed total exposure limit of $${this.maxTotalExposureUsd} (current: $${this.totalExposureUsd.toFixed(2)})`,
      };
    }
    return { allowed: true };
  }

  recordTrade(amountUsd: number): void {
    this.totalExposureUsd += amountUsd;
    this.positionCount += 1;
  }

  closeTrade(amountUsd: number): void {
    this.totalExposureUsd = Math.max(0, this.totalExposureUsd - amountUsd);
    this.positionCount = Math.max(0, this.positionCount - 1);
  }

  getSnapshot(): ExposureSnapshot {
    return {
      totalExposureUsd: this.totalExposureUsd,
      positionCount: this.positionCount,
      remainingBudgetUsd: Math.max(
        0,
        this.maxTotalExposureUsd - this.totalExposureUsd,
      ),
      maxSingleTradeUsd: this.maxSingleTradeUsd,
      maxTotalExposureUsd: this.maxTotalExposureUsd,
    };
  }

  reset(): void {
    this.totalExposureUsd = 0;
    this.positionCount = 0;
  }
}

export const exposureTracker = new ExposureTracker();
