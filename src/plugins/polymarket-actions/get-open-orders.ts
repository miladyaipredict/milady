/**
 * GET_POLYMARKET_OPEN_ORDERS — lists all unfilled orders on the CLOB.
 *
 * Uses the existing PolymarketService's authenticated client.
 * Resolves market condition_ids to human-readable names via Gamma API.
 */
import type { Action, HandlerOptions } from "@elizaos/core";
import {
  canTrade,
  getServiceOrThrow,
  resolveMarketName,
  type OpenOrderLike,
} from "./service-helper.js";

export const getOpenOrdersAction: Action = {
  name: "GET_POLYMARKET_OPEN_ORDERS",
  tags: ["always-include", "polymarket"],
  similes: [
    "POLYMARKET_OPEN_ORDERS",
    "POLYMARKET_PENDING_ORDERS",
    "POLYMARKET_MY_ORDERS",
    "POLYMARKET_RESTING_ORDERS",
    "POLYMARKET_ACTIVE_ORDERS",
  ],
  description:
    "List all open (unfilled) orders on Polymarket CLOB. Shows order ID, side, price, size, fill status, and market name. Optionally filter by market condition_id or token asset_id.",
  validate: async (runtime) => canTrade(runtime),
  handler: async (runtime, _message, _state, options) => {
    try {
      const params = (options as HandlerOptions | undefined)?.parameters;
      const market =
        typeof params?.market === "string" ? params.market.trim() : undefined;
      const assetId =
        typeof params?.assetId === "string" ? params.assetId.trim() : undefined;

      const svc = getServiceOrThrow(runtime);
      const client = svc.getAuthenticatedClient();

      const filter: { market?: string; asset_id?: string } = {};
      if (market) filter.market = market;
      if (assetId) filter.asset_id = assetId;

      const rawOrders = await client.getOpenOrders(
        Object.keys(filter).length > 0 ? filter : undefined,
      );
      const orders: OpenOrderLike[] =
        (rawOrders as any)?.data ?? rawOrders ?? [];

      if (!orders?.length) {
        return {
          text:
            market || assetId
              ? "No open orders matching the filter."
              : "No open orders.",
          success: true,
        };
      }

      // Resolve unique market condition_ids to names (best-effort, parallel)
      const uniqueMarkets = [...new Set(orders.map((o) => o.market).filter(Boolean))];
      const nameMap = new Map<string, string>();
      const nameResults = await Promise.allSettled(
        uniqueMarkets.map(async (m) => {
          const name = await resolveMarketName(m);
          if (name) nameMap.set(m, name);
        }),
      );
      void nameResults; // consumed via nameMap

      const lines = orders.map((o: OpenOrderLike, i: number) => {
        const filled =
          Number(o.size_matched) > 0
            ? ` (${o.size_matched}/${o.original_size} filled)`
            : " (unfilled)";
        const created = new Date(o.created_at * 1000).toLocaleString();
        const marketLabel = nameMap.get(o.market) ?? o.market?.slice(0, 12) + "...";
        return [
          `${i + 1}. ${o.side} ${o.original_size} @ ${o.price}${filled}`,
          `   Market: ${marketLabel} | Type: ${o.order_type} | Outcome: ${o.outcome}`,
          `   Created: ${created} | ID: ${o.id}`,
        ].join("\n");
      });

      return {
        text: `Open Orders (${orders.length}):\n\n${lines.join("\n\n")}`,
        success: true,
        data: { count: orders.length },
      };
    } catch (err) {
      return {
        text: `Failed to fetch open orders: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Show my open Polymarket orders" },
      },
      {
        name: "{{user2}}",
        content: {
          text: "Open Orders (2): ...",
          action: "GET_POLYMARKET_OPEN_ORDERS",
        },
      },
    ],
  ],
  parameters: [
    {
      name: "market",
      description: "Filter by market condition_id (optional)",
      required: false,
      schema: { type: "string" as const },
    },
    {
      name: "assetId",
      description: "Filter by token asset_id (optional)",
      required: false,
      schema: { type: "string" as const },
    },
  ],
};
