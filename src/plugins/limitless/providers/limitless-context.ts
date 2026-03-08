import { limitlessClient } from "../client.js";
import { exposureTracker } from "../exposure.js";
import type { LimitlessMarket, LimitlessPosition } from "../types.js";

const CACHE_TTL_MS = 30_000;

let cachedMarkets: LimitlessMarket[] = [];
let cachedPositions: LimitlessPosition[] = [];
let lastFetchMs = 0;

async function refresh(): Promise<void> {
  if (Date.now() - lastFetchMs < CACHE_TTL_MS) return;
  if (!limitlessClient.isReady) return;

  try {
    const [markets, positions] = await Promise.all([
      limitlessClient.getMarkets(),
      limitlessClient.getPositions(),
    ]);
    cachedMarkets = markets;
    cachedPositions = positions;
    lastFetchMs = Date.now();
  } catch (err) {
    console.warn("[limitless-context] refresh failed:", err);
  }
}

export const limitlessContextProvider = {
  name: "limitless-context",
  position: 46,

  async get(): Promise<string> {
    if (!limitlessClient.isReady) {
      return "[Limitless plugin not configured]";
    }

    await refresh();

    const exposure = exposureTracker.getSnapshot();
    const topMarkets = cachedMarkets
      .filter((m) => m.status === "active")
      .sort((a, b) => b.volumeUsd - a.volumeUsd)
      .slice(0, 10);

    const lines: string[] = [
      "## Limitless Prediction Markets",
      "",
      `Mode: ${limitlessClient.isDryRun ? "DRY RUN (simulated)" : "LIVE"}`,
      `Exposure: $${exposure.totalExposureUsd.toFixed(2)} / $${exposure.maxTotalExposureUsd} (${exposure.positionCount} positions)`,
      `Remaining budget: $${exposure.remainingBudgetUsd.toFixed(2)}`,
      "",
    ];

    if (cachedPositions.length > 0) {
      lines.push("### Open Positions");
      for (const p of cachedPositions) {
        const pnlSign = p.unrealizedPnl >= 0 ? "+" : "";
        lines.push(
          `- ${p.marketTitle}: ${p.outcome.toUpperCase()} ${p.shares} shares @ $${p.avgEntryPrice.toFixed(3)} (P&L: ${pnlSign}$${p.unrealizedPnl.toFixed(2)})`,
        );
      }
      lines.push("");
    }

    if (topMarkets.length > 0) {
      lines.push("### Top Active Markets");
      for (const m of topMarkets) {
        lines.push(
          `- [${m.id}] ${m.title} — YES $${m.prices.yes.toFixed(3)} / NO $${m.prices.no.toFixed(3)} (vol: $${m.volumeUsd.toLocaleString()})`,
        );
      }
    }

    return lines.join("\n");
  },
};
