import { limitlessClient } from "../client.js";
import { exposureTracker } from "../exposure.js";
import type { LimitlessPosition } from "../types.js";

const SUMMARY_CHAR_LIMIT = 280;

/**
 * Awareness contributor for Limitless CTF Exchange.
 * Injects position summary, exposure status, and market intelligence
 * into the agent's awareness context every LLM turn.
 *
 * Position 36 — between wallet (30) and provider (40), alongside opinion (35).
 */
export const limitlessContributor = {
  id: "limitless",
  position: 36,
  cacheTtl: 30_000,
  invalidateOn: ["limitless-updated", "config-changed", "wallet-updated"],
  trusted: true,

  async summary(_runtime: unknown): Promise<string> {
    if (!limitlessClient.isReady) return "Limitless: not connected";
    try {
      const positions = await limitlessClient.getPositions();
      const exposure = exposureTracker.getSnapshot();

      if (positions.length === 0) {
        return `Limitless: ${limitlessClient.isDryRun ? "DRY RUN" : "live"}, $${exposure.remainingBudgetUsd.toFixed(0)} budget remaining, no positions`;
      }

      const totalPnl = positions.reduce(
        (sum: number, p: LimitlessPosition) => sum + p.unrealizedPnl,
        0,
      );
      const pnlSign = totalPnl >= 0 ? "+" : "";

      const summary = `Limitless: ${positions.length} positions, ${pnlSign}$${totalPnl.toFixed(2)} unrealized, $${exposure.remainingBudgetUsd.toFixed(0)} budget${limitlessClient.isDryRun ? " (DRY RUN)" : ""}`;
      return summary.slice(0, SUMMARY_CHAR_LIMIT);
    } catch {
      return "Limitless: error fetching positions";
    }
  },

  async detail(
    _runtime: unknown,
    level: "brief" | "full",
  ): Promise<string> {
    if (!limitlessClient.isReady) return "## Limitless\nNot connected.";
    try {
      const [positions, markets] = await Promise.all([
        limitlessClient.getPositions(),
        level === "full" ? limitlessClient.getMarkets() : Promise.resolve([]),
      ]);
      const exposure = exposureTracker.getSnapshot();

      const lines = [
        "## Limitless CTF Exchange",
        `Mode: ${limitlessClient.isDryRun ? "DRY RUN (simulated)" : "LIVE TRADING"}`,
        `Exposure: $${exposure.totalExposureUsd.toFixed(2)} / $${exposure.maxTotalExposureUsd}`,
        `Budget remaining: $${exposure.remainingBudgetUsd.toFixed(2)}`,
        `Max single trade: $${exposure.maxSingleTradeUsd}`,
        "",
      ];

      if (positions.length > 0) {
        lines.push("### Open Positions");
        for (const p of positions) {
          const pnlSign = p.unrealizedPnl >= 0 ? "+" : "";
          lines.push(
            `- **${p.marketTitle}**: ${p.outcome.toUpperCase()} ${p.shares} shares @ $${p.avgEntryPrice.toFixed(3)} → $${p.currentPrice.toFixed(3)} (${pnlSign}$${p.unrealizedPnl.toFixed(2)})`,
          );
        }
        const totalPnl = positions.reduce(
          (sum: number, p: LimitlessPosition) => sum + p.unrealizedPnl,
          0,
        );
        lines.push(
          `\n**Total P&L:** ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`,
        );
      } else {
        lines.push("No open positions.");
      }

      if (level === "full" && markets.length > 0) {
        const active = markets
          .filter((m) => m.status === "active")
          .sort((a, b) => b.volumeUsd - a.volumeUsd)
          .slice(0, 10);
        if (active.length > 0) {
          lines.push("", "### Top Active Markets");
          for (const m of active) {
            lines.push(
              `- **${m.title}** — YES $${m.prices.yes.toFixed(3)} / NO $${m.prices.no.toFixed(3)} (vol: $${m.volumeUsd.toLocaleString()})`,
            );
          }
        }
      }

      return lines.join("\n");
    } catch (err) {
      return `## Limitless\nError: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
