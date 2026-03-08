/**
 * API routes for Limitless CTF Exchange prediction market plugin.
 *
 *   GET  /api/limitless/markets           — List active markets
 *   GET  /api/limitless/markets/:id       — Single market detail + orderbook
 *   GET  /api/limitless/positions         — Current positions
 *   GET  /api/limitless/exposure          — Exposure snapshot
 *   POST /api/limitless/trade             — Place a trade
 *   POST /api/limitless/cancel            — Cancel an order
 *   GET  /api/limitless/strategies        — List strategies (stub)
 *   POST /api/limitless/strategies/:id/toggle — Toggle strategy (stub)
 */

import type { RouteHelpers, RouteRequestMeta } from "./route-helpers";

export interface LimitlessRouteContext
  extends RouteRequestMeta,
    Pick<RouteHelpers, "json" | "error" | "readJsonBody"> {}

// Lazy imports to avoid hard dependency when plugin is not loaded.
async function getClient() {
  try {
    const mod = await import("../plugins/limitless/client.js");
    return mod.limitlessClient;
  } catch {
    return null;
  }
}

async function getExposure() {
  try {
    const mod = await import("../plugins/limitless/exposure.js");
    return mod.exposureTracker;
  } catch {
    return null;
  }
}

export async function handleLimitlessRoutes(
  ctx: LimitlessRouteContext,
): Promise<boolean> {
  const { res, method, pathname, json, error, readJsonBody } = ctx;

  if (!pathname.startsWith("/api/limitless/")) return false;

  const client = await getClient();
  if (!client || !client.isReady) {
    error(res, "Limitless plugin not configured", 503);
    return true;
  }

  // ── GET /api/limitless/markets ──────────────────────────────────────
  if (method === "GET" && pathname === "/api/limitless/markets") {
    try {
      const markets = await client.getMarkets();
      json(res, { markets });
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // ── GET /api/limitless/markets/:id ──────────────────────────────────
  const marketMatch = pathname.match(/^\/api\/limitless\/markets\/(.+)$/);
  if (method === "GET" && marketMatch) {
    try {
      const market = await client.getMarket(decodeURIComponent(marketMatch[1]));
      const orderbook = await client.getOrderbook(market.conditionId);
      json(res, { market, orderbook });
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // ── GET /api/limitless/positions ────────────────────────────────────
  if (method === "GET" && pathname === "/api/limitless/positions") {
    try {
      const positions = await client.getPositions();
      json(res, { positions });
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err), 502);
    }
    return true;
  }

  // ── GET /api/limitless/exposure ─────────────────────────────────────
  if (method === "GET" && pathname === "/api/limitless/exposure") {
    const tracker = await getExposure();
    if (!tracker) {
      error(res, "Exposure tracker unavailable", 503);
      return true;
    }
    json(res, tracker.getSnapshot());
    return true;
  }

  // ── POST /api/limitless/trade ───────────────────────────────────────
  if (method === "POST" && pathname === "/api/limitless/trade") {
    const body = await readJsonBody<{
      conditionId: string;
      side: "buy" | "sell";
      outcome: "yes" | "no";
      amountUsd: number;
      price?: number;
    }>(ctx.req, res);
    if (!body) return true; // readJsonBody already sent error

    if (!body.conditionId || !body.side || !body.outcome || !body.amountUsd) {
      error(res, "Missing required fields: conditionId, side, outcome, amountUsd", 400);
      return true;
    }

    try {
      const result = await client.placeTrade(body);
      json(res, result, result.ok ? 200 : 422);
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err), 500);
    }
    return true;
  }

  // ── POST /api/limitless/cancel ──────────────────────────────────────
  if (method === "POST" && pathname === "/api/limitless/cancel") {
    const body = await readJsonBody<{ orderId: string }>(ctx.req, res);
    if (!body) return true;

    if (!body.orderId) {
      error(res, "Missing required field: orderId", 400);
      return true;
    }

    try {
      const result = await client.cancelOrder(body.orderId);
      json(res, result, result.ok ? 200 : 422);
    } catch (err) {
      error(res, err instanceof Error ? err.message : String(err), 500);
    }
    return true;
  }

  // ── GET /api/limitless/strategies ───────────────────────────────────
  if (method === "GET" && pathname === "/api/limitless/strategies") {
    // Stub: strategies are a future feature
    json(res, { strategies: [] });
    return true;
  }

  // ── POST /api/limitless/strategies/:id/toggle ───────────────────────
  const strategyToggle = pathname.match(
    /^\/api\/limitless\/strategies\/(.+)\/toggle$/,
  );
  if (method === "POST" && strategyToggle) {
    // Stub: strategies are a future feature
    json(res, { id: decodeURIComponent(strategyToggle[1]), running: false });
    return true;
  }

  return false;
}
