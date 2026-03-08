import { limitlessClient } from "../client.js";
import type { LimitlessMarket } from "../types.js";

export const listMarketsAction = {
  name: "LIST_LIMITLESS_MARKETS",
  description: "List active prediction markets on Limitless Exchange",
  similes: ["show markets", "list markets", "prediction markets", "what markets are available"],

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
      const markets = await limitlessClient.getMarkets();
      const active = markets
        .filter((m: LimitlessMarket) => m.status === "active")
        .sort((a: LimitlessMarket, b: LimitlessMarket) => b.volumeUsd - a.volumeUsd);

      if (active.length === 0) {
        callback({ text: "No active markets found on Limitless." });
        return;
      }

      const lines = active.slice(0, 20).map(
        (m: LimitlessMarket) =>
          `• **${m.title}**\n  ID: \`${m.id}\` | YES: $${m.prices.yes.toFixed(3)} | NO: $${m.prices.no.toFixed(3)} | Vol: $${m.volumeUsd.toLocaleString()}`,
      );

      callback({
        text: `Found ${active.length} active markets on Limitless:\n\n${lines.join("\n\n")}`,
      });
    } catch (err) {
      callback({
        text: `Failed to fetch markets: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
};
