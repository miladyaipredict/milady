/**
 * Alpha Scanner API — Uses the agent's connected LLM to analyze prediction
 * markets and surface exploitable niches, mispriced outcomes, and edge cases.
 *
 *   POST /api/trading/alpha-scan     — Run a full market scan
 *   GET  /api/trading/alpha-scan     — Get last scan results (cached)
 */

import type { AgentRuntime } from "@elizaos/core";
import { ModelType } from "@elizaos/core";
import type { RouteHelpers, RouteRequestMeta } from "./route-helpers";

export interface AlphaScanRouteContext
  extends RouteRequestMeta,
    Pick<RouteHelpers, "json" | "error" | "readJsonBody"> {
  runtime: AgentRuntime | null;
}

// ── Types ───────────────────────────────────────────────────────────────

interface AlphaOpportunity {
  marketId: string;
  source: string;
  title: string;
  signal: "mispriced" | "momentum" | "contrarian" | "arbitrage" | "event-driven" | "niche";
  confidence: number; // 0-100
  reasoning: string;
  suggestedSide: "yes" | "no";
  currentPrice: number;
  fairValue: number;
  edge: number; // percentage edge
  riskLevel: "low" | "medium" | "high";
  suggestedSize: number; // USD
  timeframe: string;
}

interface AlphaScanResult {
  opportunities: AlphaOpportunity[];
  marketsSurveyed: number;
  modelUsed: string;
  scanDurationMs: number;
  timestamp: string;
  summary: string;
}

// ── Cache ───────────────────────────────────────────────────────────────

let lastScan: AlphaScanResult | null = null;
let scanInProgress = false;

// ── Market data fetchers ────────────────────────────────────────────────

interface MarketSnapshot {
  id: string;
  source: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  endDate: string;
}

async function fetchAllMarkets(): Promise<MarketSnapshot[]> {
  const markets: MarketSnapshot[] = [];

  // Limitless
  try {
    const mod = await import("../plugins/limitless/client.js");
    if (mod.limitlessClient?.isReady) {
      const lMarkets = await mod.limitlessClient.getMarkets();
      for (const m of lMarkets) {
        if (m.status !== "active") continue;
        markets.push({
          id: m.id,
          source: "limitless",
          title: m.title,
          yesPrice: m.prices.yes,
          noPrice: m.prices.no,
          volume: m.volumeUsd,
          endDate: m.endDate ?? "",
        });
      }
    }
  } catch { /* plugin not loaded */ }

  // Opinion
  try {
    const mod = await import("../plugins/opinion/client.js");
    if (mod.opinionClient?.isReady) {
      const response = await mod.opinionClient.getMarkets(1, 50);
      const list = response?.result?.list ?? [];
      for (const m of list) {
        const children = m.childMarkets ?? [];
        const yesChild = children.find(
          (c: { outcomeName?: string }) => c.outcomeName === "Yes",
        );
        const noChild = children.find(
          (c: { outcomeName?: string }) => c.outcomeName === "No",
        );
        const parsePrice = (c: { outcomePrices?: string; lastPrice?: number | string } | undefined): number => {
          if (!c) return 0.5;
          if (c.outcomePrices) {
            try { return Number(JSON.parse(c.outcomePrices)[0]) || 0.5; } catch { return 0.5; }
          }
          return Number(c.lastPrice) || 0.5;
        };
        markets.push({
          id: String(m.id),
          source: "opinion",
          title: m.title ?? m.question ?? "Untitled",
          yesPrice: parsePrice(yesChild),
          noPrice: parsePrice(noChild),
          volume: m.volume ?? 0,
          endDate: m.endTime ?? m.endDate ?? "",
        });
      }
    }
  } catch { /* plugin not loaded */ }

  return markets;
}

// ── Prompt builder ──────────────────────────────────────────────────────

function buildAlphaScanPrompt(markets: MarketSnapshot[]): string {
  const marketLines = markets
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 80) // Cap to avoid token overflow
    .map((m, i) => {
      const spread = Math.abs(m.yesPrice + m.noPrice - 1);
      const daysToEnd = m.endDate
        ? Math.max(0, Math.round((new Date(m.endDate).getTime() - Date.now()) / 86400000))
        : null;
      return `${i + 1}. [${m.source}] "${m.title}" — YES: ${(m.yesPrice * 100).toFixed(1)}% / NO: ${(m.noPrice * 100).toFixed(1)}% | Vol: $${m.volume.toFixed(0)} | Spread: ${(spread * 100).toFixed(2)}%${daysToEnd != null ? ` | ${daysToEnd}d left` : ""}`;
    })
    .join("\n");

  return `You are an elite prediction market analyst and alpha generator for an AI trading agent. Your job is to find exploitable opportunities that most traders miss.

## Active Markets (${markets.length} total)
${marketLines}

## Your Analysis Task

Analyze these markets and identify the BEST opportunities using these strategies:

1. **Mispriced outcomes** — Where the market price doesn't reflect true probability. Look for binary events where public sentiment is wrong or anchored on stale information.
2. **Momentum plays** — Markets showing strong directional movement that hasn't fully priced in yet.
3. **Contrarian bets** — Crowded trades where consensus is likely wrong. The best alpha is often the most uncomfortable trade.
4. **Arbitrage** — Cross-market or spread inefficiencies (YES + NO not summing to 100%, or related markets with contradictory pricing).
5. **Event-driven** — Markets where upcoming catalysts (elections, earnings, court rulings, policy decisions) create asymmetric risk/reward.
6. **Niche/obscure** — Low-volume markets that sophisticated traders haven't found yet, where edge is largest.

## IMPORTANT Rules
- Focus on NICHE and OBSCURE markets — these have the highest edge because fewer participants mean less efficient pricing.
- Wide spreads (YES + NO far from 100%) indicate illiquidity = opportunity.
- Low volume markets often have the most mispricing.
- Be specific about WHY a market is mispriced and what your fair value estimate is.
- Assign realistic confidence (40-90, not 95-100 — overconfidence is the enemy).
- Consider resolution criteria carefully — ambiguous resolution = risk.
- Small position sizes for uncertain bets, larger for high-conviction.

## Response Format

Return a JSON array of opportunities. Each opportunity:
\`\`\`json
[
  {
    "marketId": "string (from the list)",
    "source": "limitless|opinion|polymarket",
    "title": "market title",
    "signal": "mispriced|momentum|contrarian|arbitrage|event-driven|niche",
    "confidence": 65,
    "reasoning": "2-3 sentence explanation of the edge",
    "suggestedSide": "yes|no",
    "currentPrice": 0.45,
    "fairValue": 0.62,
    "edge": 17.0,
    "riskLevel": "low|medium|high",
    "suggestedSize": 5,
    "timeframe": "hours|days|weeks"
  }
]
\`\`\`

Return 3-8 opportunities, ranked by risk-adjusted edge (best first). Focus on quality over quantity. If there are no good opportunities, return an empty array — don't force bad trades.

Also provide a brief overall market summary (2-3 sentences) as the last line after the JSON, prefixed with "SUMMARY: ".

Return ONLY the JSON array followed by the SUMMARY line. No other text.`;
}

// ── Parse LLM response ──────────────────────────────────────────────────

function parseScanResponse(
  raw: string,
  markets: MarketSnapshot[],
): { opportunities: AlphaOpportunity[]; summary: string } {
  let summary = "";
  let jsonStr = raw;

  // Extract summary
  const summaryMatch = raw.match(/SUMMARY:\s*(.+?)$/ms);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
    jsonStr = raw.slice(0, summaryMatch.index).trim();
  }

  // Extract JSON array
  const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { opportunities: [], summary: summary || "No opportunities found." };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
    const marketMap = new Map(markets.map((m) => [`${m.source}-${m.id}`, m]));

    const opportunities: AlphaOpportunity[] = parsed
      .filter((o) => o && typeof o === "object" && o.marketId)
      .map((o) => ({
        marketId: String(o.marketId),
        source: String(o.source ?? "unknown"),
        title: String(o.title ?? ""),
        signal: (["mispriced", "momentum", "contrarian", "arbitrage", "event-driven", "niche"].includes(
          String(o.signal),
        )
          ? String(o.signal)
          : "niche") as AlphaOpportunity["signal"],
        confidence: Math.min(100, Math.max(0, Number(o.confidence) || 50)),
        reasoning: String(o.reasoning ?? ""),
        suggestedSide: (o.suggestedSide === "no" ? "no" : "yes") as "yes" | "no",
        currentPrice: Number(o.currentPrice) || 0.5,
        fairValue: Number(o.fairValue) || 0.5,
        edge: Number(o.edge) || 0,
        riskLevel: (["low", "medium", "high"].includes(String(o.riskLevel))
          ? String(o.riskLevel)
          : "medium") as AlphaOpportunity["riskLevel"],
        suggestedSize: Math.max(1, Number(o.suggestedSize) || 5),
        timeframe: String(o.timeframe ?? "days"),
      }))
      .slice(0, 10);

    return { opportunities, summary: summary || "Scan complete." };
  } catch {
    return { opportunities: [], summary: summary || "Failed to parse analysis." };
  }
}

// ── Route handler ───────────────────────────────────────────────────────

export async function handleAlphaScanRoutes(
  ctx: AlphaScanRouteContext,
): Promise<boolean> {
  const { res, method, pathname, json, error, runtime } = ctx;

  // GET — return cached results
  if (method === "GET" && pathname === "/api/trading/alpha-scan") {
    if (scanInProgress) {
      json(res, { scanning: true, result: lastScan });
      return true;
    }
    json(res, { scanning: false, result: lastScan });
    return true;
  }

  // POST — run new scan
  if (method === "POST" && pathname === "/api/trading/alpha-scan") {
    if (!runtime) {
      error(res, "Runtime not available — agent not started", 503);
      return true;
    }

    if (scanInProgress) {
      error(res, "Scan already in progress", 429);
      return true;
    }

    scanInProgress = true;
    const startMs = Date.now();

    try {
      // 1. Fetch all markets
      const markets = await fetchAllMarkets();
      if (markets.length === 0) {
        scanInProgress = false;
        error(
          res,
          "No markets available. Configure at least one prediction market plugin (LIMITLESS_API_KEY, OPINION_API_KEY).",
          404,
        );
        return true;
      }

      // 2. Build prompt and call LLM
      const prompt = buildAlphaScanPrompt(markets);

      const llmResult = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt,
        temperature: 0.7,
        maxTokens: 4000,
      });
      const text = typeof llmResult === "string" ? llmResult : String(llmResult);

      // 3. Parse response
      const { opportunities, summary } = parseScanResponse(text, markets);

      // 4. Determine model name
      let modelUsed = "unknown";
      try {
        const char = runtime.character as Record<string, unknown> | undefined;
        modelUsed =
          String(
            char?.modelProvider ??
              process.env.MILADY_MODEL_PROVIDER ??
              "connected model",
          );
      } catch { /* ignore */ }

      const result: AlphaScanResult = {
        opportunities,
        marketsSurveyed: markets.length,
        modelUsed,
        scanDurationMs: Date.now() - startMs,
        timestamp: new Date().toISOString(),
        summary,
      };

      lastScan = result;
      scanInProgress = false;

      json(res, { scanning: false, result });
    } catch (err) {
      scanInProgress = false;
      error(
        res,
        `Scan failed: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }
    return true;
  }

  return false;
}
