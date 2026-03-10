/**
 * GET_POLYMARKET_RULES — reads the fine print of how a market resolves.
 *
 * Uses the Gamma API to fetch resolution_source and specific_rules so the
 * agent understands exactly what determines YES vs NO before betting.
 */
import type { Action, HandlerOptions } from "@elizaos/core";
import {
  fetchGammaMarket,
  fetchGammaMarketBySlug,
  hasService,
} from "./service-helper.js";

export const getMarketRulesAction: Action = {
  name: "GET_POLYMARKET_RULES",
  tags: ["always-include", "polymarket"],
  similes: [
    "POLYMARKET_MARKET_RULES",
    "POLYMARKET_RESOLUTION_RULES",
    "POLYMARKET_HOW_RESOLVES",
    "POLYMARKET_FINE_PRINT",
    "POLYMARKET_CHECK_RULES",
  ],
  description:
    "Read the resolution rules and fine print for a Polymarket market. Shows what determines YES vs NO, the resolution source, end date, and description. Requires a condition_id or market slug.",
  validate: async (runtime) => hasService(runtime),
  handler: async (_runtime, _message, _state, options) => {
    try {
      const params = (options as HandlerOptions | undefined)?.parameters;
      const conditionId =
        typeof params?.conditionId === "string"
          ? params.conditionId.trim()
          : undefined;
      const slug =
        typeof params?.slug === "string" ? params.slug.trim() : undefined;

      if (!conditionId && !slug) {
        return {
          text: "I need a condition_id or market slug. Use POLYMARKET_GET_MARKETS to find one first.",
          success: false,
        };
      }

      const market = conditionId
        ? await fetchGammaMarket(conditionId)
        : await fetchGammaMarketBySlug(slug as string);

      if (!market) {
        return {
          text: `Market not found for ${conditionId ? `condition_id: ${conditionId}` : `slug: ${slug}`}.`,
          success: false,
        };
      }

      const lines: string[] = [];
      lines.push(market.question ?? "Unknown market");

      if (market.description) {
        lines.push(`\nDescription: ${market.description}`);
      }

      if (market.specific_rules) {
        lines.push(`\nResolution Rules:\n${market.specific_rules}`);
      } else {
        lines.push("\nResolution Rules: Not specified.");
      }

      if (market.resolution_source) {
        lines.push(`\nResolution Source: ${market.resolution_source}`);
      }

      const end = market.end_date_iso
        ? new Date(market.end_date_iso).toLocaleString()
        : "TBD";
      lines.push(`\nEnd Date: ${end}`);

      const tokens = market.tokens ?? [];
      if (tokens.length > 0) {
        const tokenLines = tokens.map(
          (t) =>
            `  ${t.outcome}: ${(t.price * 100).toFixed(0)}¢ (token: ${t.token_id})`,
        );
        lines.push(`\nOutcomes:\n${tokenLines.join("\n")}`);
      }

      const cid =
        market.condition_id ?? market.conditionId ?? conditionId ?? "";
      lines.push(`\nCondition ID: ${cid}`);

      return {
        text: lines.join("\n"),
        success: true,
        data: {
          conditionId: cid,
          question: market.question,
          rules: market.specific_rules,
          resolutionSource: market.resolution_source,
          endDate: market.end_date_iso,
        },
      };
    } catch (err) {
      return {
        text: `Failed to fetch market rules: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What are the resolution rules for the Bitcoin market?" },
      },
      {
        name: "{{user2}}",
        content: {
          text: "Will Bitcoin reach $100k?\n\nResolution Rules: ...",
          action: "GET_POLYMARKET_RULES",
        },
      },
    ],
  ],
  parameters: [
    {
      name: "conditionId",
      description: "Market condition ID (hex string from search results)",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "slug",
      description: "Market slug (alternative to conditionId)",
      required: false,
      schema: { type: "string" as const },
    },
  ],
};
