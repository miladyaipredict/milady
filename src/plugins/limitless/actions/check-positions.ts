import { limitlessClient } from "../client.js";
import { exposureTracker } from "../exposure.js";

export const checkPositionsAction = {
  name: "CHECK_LIMITLESS_POSITIONS",
  description: "Check current positions and exposure on Limitless",
  similes: ["my positions", "portfolio", "exposure", "check holdings", "P&L"],

  async validate(): Promise<boolean> {
    return limitlessClient.isReady;
  },

  async handler(
    _runtime: unknown,
    _message: unknown,
    _state: unknown,
    _options: unknown,
    callback: (response: { text: string }) => void,
  ): Promise<void> {
    try {
      const [positions, exposure] = await Promise.all([
        limitlessClient.getPositions(),
        Promise.resolve(exposureTracker.getSnapshot()),
      ]);

      const lines = [
        `**Exposure:** $${exposure.totalExposureUsd.toFixed(2)} / $${exposure.maxTotalExposureUsd}`,
        `**Remaining budget:** $${exposure.remainingBudgetUsd.toFixed(2)}`,
        `**Positions:** ${exposure.positionCount}`,
        "",
      ];

      if (positions.length === 0) {
        lines.push("No open positions.");
      } else {
        for (const p of positions) {
          const pnlSign = p.unrealizedPnl >= 0 ? "+" : "";
          lines.push(
            `• **${p.marketTitle}** — ${p.outcome.toUpperCase()} ${p.shares} shares @ $${p.avgEntryPrice.toFixed(3)}`,
          );
          lines.push(
            `  Current: $${p.currentPrice.toFixed(3)} | P&L: ${pnlSign}$${p.unrealizedPnl.toFixed(2)}`,
          );
        }
      }

      callback({ text: lines.join("\n") });
    } catch (err) {
      callback({
        text: `Failed to fetch positions: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
};
