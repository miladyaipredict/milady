/**
 * GET_POLYMARKET_PRICE_HISTORY — pulls historical price data for a market
 * so the agent can do trend analysis before placing a trade.
 *
 * Uses the existing PolymarketService's CLOB client getPricesHistory().
 */
import type { Action, HandlerOptions } from "@elizaos/core";
import {
  fetchClobMarket,
  fetchGammaMarket,
  getServiceOrThrow,
  hasService,
} from "./service-helper.js";

const VALID_INTERVALS = ["1h", "6h", "1d", "1w", "max"] as const;
type Interval = (typeof VALID_INTERVALS)[number];

export const getPriceHistoryAction: Action = {
  name: "GET_POLYMARKET_PRICE_HISTORY",
  similes: [
    "POLYMARKET_PRICE_HISTORY",
    "POLYMARKET_PRICE_CHART",
    "POLYMARKET_HISTORICAL_PRICES",
    "POLYMARKET_CANDLES",
    "POLYMARKET_CANDLESTICK",
    "POLYMARKET_MARKET_TREND",
  ],
  description:
    "Get historical price data for a Polymarket market. Returns timestamped price points for trend analysis. Requires a condition_id (resolves to token_id via Gamma API) or a direct token_id. Supports intervals: 1h, 6h, 1d, 1w, max.",
  validate: async (runtime) => hasService(runtime),
  handler: async (runtime, _message, _state, options) => {
    try {
      const params = (options as HandlerOptions | undefined)?.parameters;
      const conditionId =
        typeof params?.conditionId === "string"
          ? params.conditionId.trim()
          : undefined;
      const tokenIdParam =
        typeof params?.tokenId === "string"
          ? params.tokenId.trim()
          : undefined;

      if (!conditionId && !tokenIdParam) {
        return {
          text: "I need a condition_id or token_id. Use GET_POLYMARKET_MARKETS to find one first.",
          success: false,
        };
      }

      const rawInterval =
        typeof params?.interval === "string"
          ? (params.interval.trim() as Interval)
          : "1d";
      const interval = VALID_INTERVALS.includes(rawInterval)
        ? rawInterval
        : "1d";
      const fidelity =
        typeof params?.fidelity === "number"
          ? Math.min(Math.max(params.fidelity, 1), 500)
          : 60;

      // Resolve condition_id to token_id (try CLOB first, then Gamma)
      let tokenId = tokenIdParam;
      let marketName: string | undefined;
      if (!tokenId && conditionId) {
        const clobMarket = await fetchClobMarket(conditionId);
        const clobTokens = clobMarket?.tokens ?? [];
        if (clobTokens.length > 0) {
          tokenId = clobTokens[0].token_id;
          marketName = clobMarket?.question ?? undefined;
        } else {
          // Fallback to Gamma for older markets
          const gammaMarket = await fetchGammaMarket(conditionId);
          const gammaTokens = gammaMarket?.tokens ?? [];
          if (gammaTokens.length > 0) {
            tokenId = gammaTokens[0].token_id;
            marketName = gammaMarket?.question ?? undefined;
          } else {
            return {
              text: `Could not resolve condition_id ${conditionId} to a token_id. The market may not exist.`,
              success: false,
            };
          }
        }
      }

      const svc = getServiceOrThrow(runtime);
      const client = svc.getClobClient();
      const prices = await client.getPricesHistory({
        market: tokenId!,
        interval,
        fidelity,
      });

      if (!prices?.length) {
        return {
          text: `No price history found for condition_id: ${conditionId}`,
          success: true,
        };
      }

      const values = prices.map((p) => p.p);
      const latest = values[values.length - 1];
      const oldest = values[0];
      const high = Math.max(...values);
      const low = Math.min(...values);
      const change = latest - oldest;
      const changePct = oldest !== 0 ? (change / oldest) * 100 : 0;
      const sign = change >= 0 ? "+" : "";

      const lines: string[] = [];
      if (marketName) {
        lines.push(marketName);
      }
      lines.push(`Price History (${interval}, ${prices.length} points):`);
      lines.push(
        `Current: ${(latest * 100).toFixed(1)}¢ | ${sign}${(change * 100).toFixed(1)}¢ (${sign}${changePct.toFixed(1)}%)`,
      );
      lines.push(
        `High: ${(high * 100).toFixed(1)}¢ | Low: ${(low * 100).toFixed(1)}¢`,
      );

      const startDate = new Date(prices[0].t * 1000).toLocaleDateString();
      const endDate = new Date(
        prices[prices.length - 1].t * 1000,
      ).toLocaleDateString();
      lines.push(`Period: ${startDate} → ${endDate}`);

      const tail = prices.slice(-10);
      lines.push("\nRecent prices:");
      for (const p of tail) {
        const date = new Date(p.t * 1000).toLocaleString();
        lines.push(`  ${date}: ${(p.p * 100).toFixed(1)}¢`);
      }

      return {
        text: lines.join("\n"),
        success: true,
        data: {
          conditionId,
          interval,
          points: prices.length,
          latest,
          high,
          low,
          changePct: Number(changePct.toFixed(2)),
        },
      };
    } catch (err) {
      return {
        text: `Failed to fetch price history: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Show price history for Bitcoin $100k market" },
      },
      {
        name: "{{user2}}",
        content: {
          text: "Price History (1d, 60 points): Current: 45.2¢ ...",
          action: "GET_POLYMARKET_PRICE_HISTORY",
        },
      },
    ],
  ],
  parameters: [
    {
      name: "conditionId",
      description:
        "Market condition ID (resolved to token_id via Gamma API)",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "tokenId",
      description: "Token ID (direct — skips Gamma resolution)",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "interval",
      description: "Time interval: 1h, 6h, 1d, 1w, or max (default: 1d)",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "fidelity",
      description: "Number of data points (default 60, max 500)",
      required: false,
      schema: { type: "number" as const },
    },
  ],
};
