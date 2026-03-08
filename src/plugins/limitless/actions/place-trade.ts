import { limitlessClient } from "../client.js";

export const placeTradeAction = {
  name: "PLACE_LIMITLESS_TRADE",
  description: "Place a trade on a Limitless prediction market",
  similes: ["buy yes", "buy no", "sell yes", "sell no", "place bet", "trade market"],

  async validate(): Promise<boolean> {
    return limitlessClient.isReady;
  },

  async handler(
    _runtime: unknown,
    message: {
      content?: {
        conditionId?: string;
        side?: "buy" | "sell";
        outcome?: "yes" | "no";
        amountUsd?: number;
        price?: number;
      };
    },
    _state: unknown,
    _options: unknown,
    callback: (response: { text: string }) => void,
  ): Promise<void> {
    const { conditionId, side, outcome, amountUsd, price } =
      message.content ?? {};

    if (!conditionId || !side || !outcome || !amountUsd) {
      callback({
        text: "Missing required trade parameters: conditionId, side (buy/sell), outcome (yes/no), amountUsd.",
      });
      return;
    }

    if (!["buy", "sell"].includes(side)) {
      callback({ text: "Side must be 'buy' or 'sell'." });
      return;
    }
    if (!["yes", "no"].includes(outcome)) {
      callback({ text: "Outcome must be 'yes' or 'no'." });
      return;
    }
    if (amountUsd <= 0) {
      callback({ text: "Amount must be positive." });
      return;
    }

    try {
      const result = await limitlessClient.placeTrade({
        conditionId,
        side,
        outcome,
        amountUsd,
        price,
      });

      if (result.ok) {
        const modeLabel = result.dryRun ? "🧪 DRY RUN" : "✅ LIVE";
        callback({
          text: `${modeLabel} trade placed: ${side.toUpperCase()} ${outcome.toUpperCase()} $${amountUsd}${price ? ` @ $${price}` : " (market)"}`,
        });
      } else {
        callback({ text: `Trade rejected: ${result.error}` });
      }
    } catch (err) {
      callback({
        text: `Trade failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
};
