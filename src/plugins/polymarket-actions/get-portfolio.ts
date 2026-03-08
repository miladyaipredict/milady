/**
 * GET_POLYMARKET_PORTFOLIO — checks USDC balance, positions, and open orders.
 *
 * Uses on-chain conditional token balances as ground truth for position sizes,
 * since trade-derived positions are unreliable with limited trade history.
 * Resolves market condition_ids to names and current prices via CLOB API.
 */
import type { Action, HandlerOptions } from "@elizaos/core";
import {
  canTrade,
  fetchClobMarket,
  getServiceOrThrow,
  type AccountStateLike,
  type OpenOrderLike,
} from "./service-helper.js";

/** Build positions from on-chain balances (preferred) or trade history (fallback).
 *
 * conditionalTokens from getBalanceAllowance is ground truth but may be empty
 * if the service hasn't called updateConditionalBalances yet. In that case,
 * fall back to trade-derived positions, filtering out negative sizes (artifact
 * of incomplete trade history — you can't short on Polymarket).
 */
// Conditional tokens use same 6-decimal precision as USDC
const CONDITIONAL_TOKEN_DECIMALS = 6;

function buildPositions(state: AccountStateLike) {
  const conditionalTokens = state.balances?.conditionalTokens ?? {};
  const tradePositions = state.positions ?? [];

  // Index trade-derived positions by asset_id for avg price / P&L lookup
  const tradeMap = new Map<
    string,
    { average_price: string; realized_pnl: string; market: string }
  >();
  for (const tp of tradePositions) {
    tradeMap.set(tp.asset_id, tp);
  }

  const positions: Array<{
    asset_id: string;
    market: string;
    size: number;
    avgPrice: number;
    realizedPnl: number;
  }> = [];

  const hasOnChainBalances = Object.keys(conditionalTokens).length > 0;

  if (hasOnChainBalances) {
    // Preferred: use on-chain token balances as ground truth
    // Raw balances are in micro-units (6 decimals), divide to get shares
    for (const [assetId, info] of Object.entries(conditionalTokens)) {
      const rawBal = Number(info.balance);
      if (rawBal <= 0) continue;
      const bal = rawBal / 10 ** CONDITIONAL_TOKEN_DECIMALS;

      const tradeInfo = tradeMap.get(assetId);
      positions.push({
        asset_id: assetId,
        market: tradeInfo?.market ?? assetId,
        size: bal,
        avgPrice: tradeInfo ? Number(tradeInfo.average_price) : 0,
        realizedPnl: tradeInfo ? Number(tradeInfo.realized_pnl) : 0,
      });
    }
  } else {
    // Fallback: use trade-derived positions, filtering out negatives
    for (const tp of tradePositions) {
      const size = Number(tp.size);
      if (size <= 0) continue; // skip negative/zero — artifact of incomplete history
      positions.push({
        asset_id: tp.asset_id,
        market: tp.market,
        size,
        avgPrice: Number(tp.average_price),
        realizedPnl: Number(tp.realized_pnl),
      });
    }
  }

  return positions;
}

export const getPortfolioAction: Action = {
  name: "GET_POLYMARKET_PORTFOLIO",
  similes: [
    "POLYMARKET_PORTFOLIO",
    "POLYMARKET_BALANCE",
    "POLYMARKET_POSITIONS",
    "POLYMARKET_HOLDINGS",
    "POLYMARKET_MY_BETS",
    "POLYMARKET_ACCOUNT",
    "POLYMARKET_WALLET_STATUS",
  ],
  description:
    "Check the agent's Polymarket portfolio: USDC balance, active token positions with P&L, and open orders summary. Gives a full picture of current account state.",
  validate: async (runtime) => canTrade(runtime),
  handler: async (runtime, _message, _state, options) => {
    try {
      const params = (options as HandlerOptions | undefined)?.parameters;
      const detailed = params?.detailed === true;

      const svc = getServiceOrThrow(runtime);
      let state = await svc.getAccountState();

      if (!state) {
        return {
          text: "Could not retrieve account state. Ensure Polymarket credentials are configured.",
          success: false,
        };
      }

      // Proactively fetch on-chain conditional token balances for known positions
      const tradeAssetIds = (state.positions ?? []).map((p) => p.asset_id);
      if (tradeAssetIds.length > 0 && svc.updateConditionalBalances) {
        try {
          await svc.updateConditionalBalances(tradeAssetIds);
          // Re-read cached state after balances update
          const refreshed = svc.getCachedAccountState();
          if (refreshed) state = refreshed;
        } catch {
          // best-effort — continue with whatever we have
        }
      }

      const lines: string[] = [];

      // USDC Balance
      const collateral = state.balances?.collateral;
      if (collateral) {
        lines.push(`USDC Balance: $${collateral.balance}`);
      } else {
        lines.push("USDC Balance: unavailable");
      }

      // Positions — on-chain balances preferred, trade-derived as fallback
      const positions = buildPositions(state);
      if (positions.length > 0) {
        // Resolve unique market condition_ids via CLOB API (names + current prices)
        const uniqueMarkets = [
          ...new Set(positions.map((p) => p.market).filter(Boolean)),
        ];
        const marketDataMap = new Map<
          string,
          {
            question?: string;
            tokens?: Array<{
              token_id: string;
              outcome: string;
              price: number;
            }>;
          }
        >();
        await Promise.allSettled(
          uniqueMarkets.map(async (m) => {
            const data = await fetchClobMarket(m);
            if (data) marketDataMap.set(m, data);
          }),
        );

        lines.push(`\nPositions (${positions.length}):`);
        let totalMarketValue = 0;
        for (const pos of positions) {
          const mktData = marketDataMap.get(pos.market);
          const marketLabel =
            mktData?.question ??
            (pos.market.length > 20
              ? pos.market.slice(0, 16) + "..."
              : pos.market);

          // Find current price for this token from CLOB market data
          const tokenMatch = mktData?.tokens?.find(
            (t) => t.token_id === pos.asset_id,
          );
          const currentPrice = tokenMatch?.price ?? 0;
          const outcome = tokenMatch?.outcome ?? "";
          const currentValue = pos.size * currentPrice;
          totalMarketValue += currentValue;

          const priceStr =
            currentPrice > 0
              ? ` @ ${(currentPrice * 100).toFixed(0)}c ($${currentValue.toFixed(2)})`
              : "";
          const outcomeStr = outcome ? ` ${outcome}` : "";
          const pnlStr =
            pos.realizedPnl !== 0
              ? ` | P&L: ${pos.realizedPnl >= 0 ? "+" : ""}$${pos.realizedPnl.toFixed(2)}`
              : "";
          lines.push(
            `  ${marketLabel}${outcomeStr} — ${pos.size.toFixed(1)} shares${priceStr}${pnlStr}`,
          );
          if (detailed) {
            lines.push(`    asset: ${pos.asset_id} | market: ${pos.market}`);
          }
        }

        // Summary with positions valued at current market price
        const balanceUsd = collateral ? Number(collateral.balance) : 0;
        const totalValue = balanceUsd + totalMarketValue;

        // Open Orders section first, then summary
        appendOpenOrders(lines, state.activeOrders ?? [], detailed);

        lines.push(`\nTotal account value: ~$${totalValue.toFixed(2)}`);

        return {
          text: lines.join("\n"),
          success: true,
          data: {
            usdcBalance: balanceUsd,
            positionCount: positions.length,
            openOrderCount: (state.activeOrders ?? []).length,
            totalValue,
          },
        };
      }

      lines.push("\nNo active positions.");

      // Open Orders
      const openOrders = state.activeOrders ?? [];
      appendOpenOrders(lines, openOrders, detailed);

      const balanceUsd = collateral ? Number(collateral.balance) : 0;
      lines.push(`\nTotal account value: ~$${balanceUsd.toFixed(2)}`);

      return {
        text: lines.join("\n"),
        success: true,
        data: {
          usdcBalance: balanceUsd,
          positionCount: 0,
          openOrderCount: openOrders.length,
          totalValue: balanceUsd,
        },
      };
    } catch (err) {
      return {
        text: `Failed to fetch portfolio: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Show my Polymarket portfolio" },
      },
      {
        name: "{{user2}}",
        content: {
          text: "USDC Balance: $42.50\n\nPositions (1): ...",
          action: "GET_POLYMARKET_PORTFOLIO",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "What's my Polymarket balance?" },
      },
      {
        name: "{{user2}}",
        content: {
          text: "USDC Balance: $100.00\n\nNo active positions.",
          action: "GET_POLYMARKET_PORTFOLIO",
        },
      },
    ],
  ],
  parameters: [
    {
      name: "detailed",
      description: "Show detailed order/position info (default false)",
      required: false,
      schema: { type: "boolean" as const },
    },
  ],
};

function appendOpenOrders(
  lines: string[],
  openOrders: OpenOrderLike[],
  detailed: boolean,
) {
  if (openOrders.length > 0) {
    const buyOrders = openOrders.filter((o) => o.side === "BUY");
    const sellOrders = openOrders.filter((o) => o.side === "SELL");
    const lockedValue = openOrders.reduce(
      (sum, o) =>
        sum +
        (Number(o.original_size) - Number(o.size_matched)) * Number(o.price),
      0,
    );
    lines.push(
      `\nOpen Orders: ${openOrders.length} (${buyOrders.length} buys, ${sellOrders.length} sells)`,
    );
    lines.push(`  Locked in orders: ~$${lockedValue.toFixed(2)}`);

    if (detailed) {
      for (const o of openOrders.slice(0, 5)) {
        lines.push(
          `  ${o.side} ${o.original_size} @ ${o.price} (${o.order_type}) — ${o.id.slice(0, 16)}...`,
        );
      }
      if (openOrders.length > 5) {
        lines.push(`  ... +${openOrders.length - 5} more`);
      }
    }
  } else {
    lines.push("\nNo open orders.");
  }
}
