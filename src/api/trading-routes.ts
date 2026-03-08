/**
 * Unified trading API routes that aggregate prediction markets from all sources.
 *
 *   GET  /api/trading/sources        — List active prediction market sources
 *   GET  /api/trading/markets        — Aggregated markets from all active sources
 *   GET  /api/trading/positions      — Aggregated positions from all sources
 *   GET  /api/trading/wallet-status  — EVM + Solana wallet status
 */

import type { RouteHelpers, RouteRequestMeta } from "./route-helpers";

export interface TradingRouteContext
  extends RouteRequestMeta,
    Pick<RouteHelpers, "json" | "error"> {}

/** Unified market shape for the trader UI. */
interface UnifiedMarket {
  id: string;
  source: "limitless" | "opinion" | "polymarket";
  title: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  endDate: string;
  status: string;
  /** Source-specific ID for trading (conditionId for Limitless, numeric ID for Opinion). */
  sourceId: string;
}

/** Unified position shape. */
interface UnifiedPosition {
  source: "limitless" | "opinion" | "polymarket";
  marketId: string;
  marketTitle: string;
  outcome: string;
  shares: number;
  avgEntryPrice: number;
  currentPrice: number;
  pnl: number;
}

interface SourceStatus {
  id: string;
  name: string;
  enabled: boolean;
  canTrade: boolean;
  chain: string;
}

// ── Lazy imports (no hard dependencies) ─────────────────────────────────

async function getLimitlessClient() {
  try {
    const mod = await import("../plugins/limitless/client.js");
    return mod.limitlessClient;
  } catch {
    return null;
  }
}

async function getOpinionClient() {
  try {
    const mod = await import("../plugins/opinion/client.js");
    return mod.opinionClient;
  } catch {
    return null;
  }
}

export async function handleTradingRoutes(
  ctx: TradingRouteContext,
): Promise<boolean> {
  const { res, method, pathname, json, error } = ctx;

  if (!pathname.startsWith("/api/trading/")) return false;

  // ── GET /api/trading/sources ────────────────────────────────────────
  if (method === "GET" && pathname === "/api/trading/sources") {
    const sources: SourceStatus[] = [];

    const limitless = await getLimitlessClient();
    sources.push({
      id: "limitless",
      name: "Limitless CTF",
      enabled: limitless?.isReady ?? false,
      canTrade: limitless?.canTrade ?? false,
      chain: "Base",
    });

    const opinion = await getOpinionClient();
    sources.push({
      id: "opinion",
      name: "Opinion Trade",
      enabled: opinion?.isReady ?? false,
      canTrade: opinion?.canTrade ?? false,
      chain: "BNB Chain",
    });

    // Polymarket — check if env is configured
    sources.push({
      id: "polymarket",
      name: "Polymarket",
      enabled: Boolean(process.env.CLOB_API_KEY?.trim()),
      canTrade: Boolean(
        process.env.CLOB_API_KEY?.trim() &&
          process.env.POLYMARKET_PRIVATE_KEY?.trim(),
      ),
      chain: "Polygon",
    });

    // Web3 wallets
    const hasEvm = Boolean(process.env.EVM_PRIVATE_KEY?.trim());
    const hasSolana = Boolean(process.env.SOLANA_PRIVATE_KEY?.trim());

    json(res, {
      sources,
      wallets: {
        evm: hasEvm,
        solana: hasSolana,
      },
      research: {
        browser: Boolean(process.env.MILADY_FEATURE_BROWSER === "true"),
        rss: Boolean(process.env.RSS_FEEDS?.trim()),
      },
    });
    return true;
  }

  // ── GET /api/trading/markets?source=all|limitless|opinion ───────────
  if (method === "GET" && pathname === "/api/trading/markets") {
    const url = new URL(pathname, "http://localhost");
    // Parse query params from the raw request URL
    const reqUrl = new URL(ctx.req.url ?? "/", "http://localhost");
    const sourceFilter = reqUrl.searchParams.get("source") ?? "all";

    const markets: UnifiedMarket[] = [];

    // Limitless markets
    if (sourceFilter === "all" || sourceFilter === "limitless") {
      const limitless = await getLimitlessClient();
      if (limitless?.isReady) {
        try {
          const lMarkets = await limitless.getMarkets();
          for (const m of lMarkets) {
            if (m.status !== "active") continue;
            markets.push({
              id: `limitless-${m.id}`,
              source: "limitless",
              title: m.title,
              yesPrice: m.prices.yes,
              noPrice: m.prices.no,
              volume: m.volumeUsd,
              endDate: m.endDate ?? "",
              status: m.status,
              sourceId: m.conditionId,
            });
          }
        } catch (err) {
          console.warn("[trading] Failed to fetch limitless markets:", err);
        }
      }
    }

    // Opinion markets
    if (sourceFilter === "all" || sourceFilter === "opinion") {
      const opinion = await getOpinionClient();
      if (opinion?.isReady) {
        try {
          const response = await opinion.getMarkets(1, 50);
          const list = response?.result?.list ?? [];
          for (const m of list) {
            const children = m.childMarkets ?? [];
            const yesChild = children.find(
              (c: { outcomeName?: string; outcome?: string }) =>
                c.outcomeName === "Yes" || c.outcome === "yes",
            );
            const noChild = children.find(
              (c: { outcomeName?: string; outcome?: string }) =>
                c.outcomeName === "No" || c.outcome === "no",
            );
            const parsePrice = (c: { outcomePrices?: string; lastPrice?: number | string } | undefined): number => {
              if (!c) return 0.5;
              if (c.outcomePrices) {
                try {
                  const prices = JSON.parse(c.outcomePrices);
                  return Number(prices[0]) || 0.5;
                } catch {
                  return 0.5;
                }
              }
              return Number(c.lastPrice) || 0.5;
            };

            markets.push({
              id: `opinion-${m.id}`,
              source: "opinion",
              title: m.title ?? m.question ?? "Untitled",
              yesPrice: parsePrice(yesChild),
              noPrice: parsePrice(noChild),
              volume: m.volume ?? 0,
              endDate: m.endTime ?? m.endDate ?? "",
              status: "active",
              sourceId: String(m.id),
            });
          }
        } catch (err) {
          console.warn("[trading] Failed to fetch opinion markets:", err);
        }
      }
    }

    // Sort by volume descending
    markets.sort((a, b) => b.volume - a.volume);

    json(res, {
      markets,
      total: markets.length,
    });
    return true;
  }

  // ── GET /api/trading/positions ──────────────────────────────────────
  if (method === "GET" && pathname === "/api/trading/positions") {
    const positions: UnifiedPosition[] = [];
    let totalPnl = 0;

    // Limitless positions
    const limitless = await getLimitlessClient();
    if (limitless?.isReady) {
      try {
        const lPositions = await limitless.getPositions();
        for (const p of lPositions) {
          positions.push({
            source: "limitless",
            marketId: p.marketId,
            marketTitle: p.marketTitle,
            outcome: p.outcome,
            shares: p.shares,
            avgEntryPrice: p.avgEntryPrice,
            currentPrice: p.currentPrice,
            pnl: p.unrealizedPnl,
          });
          totalPnl += p.unrealizedPnl;
        }
      } catch (err) {
        console.warn("[trading] Failed to fetch limitless positions:", err);
      }
    }

    // Opinion positions
    const opinion = await getOpinionClient();
    if (opinion?.isReady) {
      try {
        const response = await opinion.getPositions();
        const oPositions = response?.result ?? [];
        for (const p of oPositions as Array<{
          marketId?: number;
          marketTitle?: string;
          side?: string;
          shares?: number | string;
          avgEntryPrice?: number | string;
          avgPrice?: number | string;
          currentPrice?: number | string;
          unrealizedPnl?: number | string;
        }>) {
          const pnl = Number(p.unrealizedPnl) || 0;
          positions.push({
            source: "opinion",
            marketId: String(p.marketId ?? ""),
            marketTitle: p.marketTitle ?? "",
            outcome: p.side ?? "yes",
            shares: Number(p.shares) || 0,
            avgEntryPrice: Number(p.avgEntryPrice ?? p.avgPrice) || 0,
            currentPrice: Number(p.currentPrice) || 0,
            pnl,
          });
          totalPnl += pnl;
        }
      } catch (err) {
        console.warn("[trading] Failed to fetch opinion positions:", err);
      }
    }

    json(res, { positions, totalPnl });
    return true;
  }

  // ── GET /api/trading/wallet-status ──────────────────────────────────
  if (method === "GET" && pathname === "/api/trading/wallet-status") {
    const wallets: {
      chain: string;
      configured: boolean;
      address?: string;
    }[] = [];

    if (process.env.EVM_PRIVATE_KEY?.trim()) {
      try {
        const { ethers } = await import("ethers");
        const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY.trim());
        wallets.push({
          chain: "EVM (Base/Ethereum)",
          configured: true,
          address: wallet.address,
        });
      } catch {
        wallets.push({ chain: "EVM (Base/Ethereum)", configured: true });
      }
    } else {
      wallets.push({ chain: "EVM (Base/Ethereum)", configured: false });
    }

    wallets.push({
      chain: "Solana",
      configured: Boolean(process.env.SOLANA_PRIVATE_KEY?.trim()),
    });

    json(res, { wallets });
    return true;
  }

  return false;
}
