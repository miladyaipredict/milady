import { limitlessClient } from "../client.js";

export const getMarketAction = {
  name: "GET_LIMITLESS_MARKET",
  description: "Get details and orderbook for a specific Limitless market",
  similes: ["market detail", "show market", "orderbook", "market info"],

  async validate(): Promise<boolean> {
    return limitlessClient.isReady;
  },

  async handler(
    _runtime: unknown,
    message: { content?: { marketId?: string; text?: string } },
    _state: unknown,
    _options: unknown,
    callback: (response: { text: string }) => void,
  ): Promise<void> {
    const marketId = message.content?.marketId || message.content?.text || "";
    if (!marketId.trim()) {
      callback({ text: "Please specify a market ID." });
      return;
    }

    try {
      const market = await limitlessClient.getMarket(marketId.trim());
      const orderbook = await limitlessClient.getOrderbook(market.conditionId);

      const topBids = orderbook.bids.slice(0, 5);
      const topAsks = orderbook.asks.slice(0, 5);

      const lines = [
        `**${market.title}**`,
        `Status: ${market.status} | Volume: $${market.volumeUsd.toLocaleString()}`,
        `YES: $${market.prices.yes.toFixed(3)} | NO: $${market.prices.no.toFixed(3)}`,
        market.endDate ? `Ends: ${market.endDate}` : "No end date",
        "",
        "**Orderbook:**",
        `Bids: ${topBids.map((b) => `$${b.price.toFixed(3)}×${b.size}`).join(", ") || "none"}`,
        `Asks: ${topAsks.map((a) => `$${a.price.toFixed(3)}×${a.size}`).join(", ") || "none"}`,
      ];

      callback({ text: lines.join("\n") });
    } catch (err) {
      callback({
        text: `Failed to fetch market: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
};
