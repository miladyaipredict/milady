import { useCallback, useEffect, useState } from "react";
import type { LimitlessMarketSummary } from "../../api-client";
import { client } from "../../api-client";
import { useLimitlessPrices } from "../../hooks/useLimitlessPrices";
import { usePriceHistory } from "../../hooks/usePriceHistory";
import { PriceSparkline } from "./PriceSparkline";

interface MarketDetailPanelProps {
  marketId: string | null;
}

interface OrderbookLevel {
  price: number;
  size: number;
}

interface MarketDetail {
  market: LimitlessMarketSummary;
  orderbook: { bids: OrderbookLevel[]; asks: OrderbookLevel[] };
}

function parseMarketId(id: string): { source: string; rawId: string } {
  const dash = id.indexOf("-");
  if (dash > 0) return { source: id.slice(0, dash), rawId: id.slice(dash + 1) };
  return { source: "limitless", rawId: id };
}

const SOURCE_LABELS: Record<string, string> = {
  limitless: "Limitless CTF",
  opinion: "Opinion Trade",
  polymarket: "Polymarket",
};

const SOURCE_CHAINS: Record<string, string> = {
  limitless: "Base",
  opinion: "BNB Chain",
  polymarket: "Polygon",
};

type DetailTab = "orderbook" | "chart" | "info";

export function MarketDetailPanel({ marketId }: MarketDetailPanelProps) {
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("chart");
  const livePrices = useLimitlessPrices();
  const priceHistory = usePriceHistory();

  // Trade form
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [trading, setTrading] = useState(false);
  const [tradeResult, setTradeResult] = useState<{
    ok: boolean;
    dryRun: boolean;
    message: string;
  } | null>(null);

  const parsed = marketId ? parseMarketId(marketId) : null;

  useEffect(() => {
    if (!marketId || !parsed) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    setTradeResult(null);
    void (async () => {
      try {
        if (parsed.source === "limitless") {
          const res = await client.getLimitlessMarket(parsed.rawId);
          setDetail(res as MarketDetail);
        } else {
          setDetail(null);
          setError(
            `${SOURCE_LABELS[parsed.source] ?? parsed.source} detail view coming soon. Trade via chat with: "buy YES on [market name]"`,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load market");
      } finally {
        setLoading(false);
      }
    })();
  }, [marketId]);

  const handleTrade = useCallback(async () => {
    if (!detail || !amount || !parsed) return;
    setTrading(true);
    setTradeResult(null);
    try {
      const res = await client.placeLimitlessTrade({
        conditionId: detail.market.conditionId,
        side,
        outcome,
        amountUsd: Number(amount),
        price: limitPrice ? Number(limitPrice) / 100 : undefined,
      });
      setTradeResult({
        ok: res.ok,
        dryRun: res.dryRun,
        message: res.ok
          ? res.dryRun
            ? "Dry run: trade simulated successfully"
            : "Trade placed successfully"
          : res.error ?? "Trade failed",
      });
      if (res.ok) setAmount("");
    } catch (err) {
      setTradeResult({
        ok: false,
        dryRun: false,
        message: err instanceof Error ? err.message : "Trade error",
      });
    } finally {
      setTrading(false);
    }
  }, [detail, parsed, side, outcome, amount, limitPrice]);

  if (!marketId) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        <div className="text-center">
          <div className="text-2xl mb-2 opacity-20">Select a market</div>
          <p className="text-xs">Choose a market from the left panel to view details and trade</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        Loading market...
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm px-6 text-center">
        {error ?? "Market not found"}
      </div>
    );
  }

  const { market, orderbook } = detail;
  const yesPrice =
    livePrices.get(`${market.conditionId}-yes`) ?? market.yesPrice;
  const noPrice =
    livePrices.get(`${market.conditionId}-no`) ?? market.noPrice;
  const yesHistory = priceHistory.get(`${market.conditionId}-yes`) ?? [];
  const noHistory = priceHistory.get(`${market.conditionId}-no`) ?? [];
  const spread = Math.abs(yesPrice + noPrice - 1);

  // Orderbook depth calculation for visual bars
  const maxBidSize = Math.max(
    ...(orderbook?.bids ?? []).map((b) => b.size),
    1,
  );
  const maxAskSize = Math.max(
    ...(orderbook?.asks ?? []).map((a) => a.size),
    1,
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Market header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-bold text-muted/60 bg-bg-hover rounded px-1.5 py-0.5 uppercase">
            {parsed?.source ?? "unknown"}
          </span>
          <span className="text-[9px] text-muted/40">
            {SOURCE_CHAINS[parsed?.source ?? ""] ?? ""}
          </span>
        </div>
        <h2 className="text-[15px] font-semibold text-txt leading-snug">
          {market.title}
        </h2>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted">
          <span>
            Vol: $
            {market.volume >= 1000
              ? `${(market.volume / 1000).toFixed(1)}k`
              : market.volume.toFixed(0)}
          </span>
          {market.endDate && (
            <span>
              Ends:{" "}
              {new Date(market.endDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
          <span className="font-mono text-[10px]">
            Spread: {(spread * 100).toFixed(2)}%
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              market.status === "active"
                ? "bg-[#22c55e]/15 text-[#22c55e]"
                : "bg-muted/15 text-muted"
            }`}
          >
            {market.status}
          </span>
        </div>
      </div>

      {/* Price cards with sparklines */}
      <div className="grid grid-cols-2 gap-3 px-4 py-3">
        <div className="border border-[#22c55e]/30 rounded-lg p-3 bg-[#22c55e]/5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-wide text-[#22c55e]">
              YES
            </div>
            {yesHistory.length >= 3 && (
              <PriceSparkline
                data={yesHistory}
                width={56}
                height={20}
                color="#22c55e"
              />
            )}
          </div>
          <div className="text-2xl font-mono font-bold text-[#22c55e]">
            {(yesPrice * 100).toFixed(1)}
            <span className="text-sm">%</span>
          </div>
        </div>
        <div className="border border-[#ef4444]/30 rounded-lg p-3 bg-[#ef4444]/5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-wide text-[#ef4444]">
              NO
            </div>
            {noHistory.length >= 3 && (
              <PriceSparkline
                data={noHistory}
                width={56}
                height={20}
                color="#ef4444"
              />
            )}
          </div>
          <div className="text-2xl font-mono font-bold text-[#ef4444]">
            {(noPrice * 100).toFixed(1)}
            <span className="text-sm">%</span>
          </div>
        </div>
      </div>

      {/* Detail tabs */}
      <div className="flex gap-0.5 px-4 border-b border-border">
        {(["chart", "orderbook", "info"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setDetailTab(tab)}
            className={`px-3 py-1.5 text-[11px] font-medium cursor-pointer border-b-2 transition-colors ${
              detailTab === tab
                ? "text-accent border-accent"
                : "text-muted border-transparent hover:text-txt"
            }`}
          >
            {tab === "chart" ? "Chart" : tab === "orderbook" ? "Book" : "Info"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 py-2 flex-1 min-h-0">
        {detailTab === "chart" && (
          <div className="space-y-3">
            {/* Large chart area */}
            <div className="border border-border/50 rounded-lg p-3 bg-bg-hover/20">
              <div className="text-[10px] text-muted mb-2">YES Price (last {yesHistory.length} ticks)</div>
              {yesHistory.length >= 3 ? (
                <PriceSparkline
                  data={yesHistory}
                  width={320}
                  height={80}
                  color="#22c55e"
                />
              ) : (
                <div className="h-20 flex items-center justify-center text-[11px] text-muted/50">
                  Collecting price data...
                </div>
              )}
            </div>
            <div className="border border-border/50 rounded-lg p-3 bg-bg-hover/20">
              <div className="text-[10px] text-muted mb-2">NO Price</div>
              {noHistory.length >= 3 ? (
                <PriceSparkline
                  data={noHistory}
                  width={320}
                  height={80}
                  color="#ef4444"
                />
              ) : (
                <div className="h-20 flex items-center justify-center text-[11px] text-muted/50">
                  Collecting price data...
                </div>
              )}
            </div>
          </div>
        )}

        {detailTab === "orderbook" && orderbook && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4 text-[11px] font-mono">
              {/* Bids */}
              <div>
                <div className="text-muted mb-1.5 text-[10px] uppercase tracking-wide">
                  Bids
                </div>
                {(orderbook.bids ?? []).slice(0, 8).map((b, i) => (
                  <div key={`bid-${i}`} className="flex items-center gap-1 mb-0.5 relative">
                    <div
                      className="absolute inset-0 bg-[#22c55e]/8 rounded-sm"
                      style={{ width: `${(b.size / maxBidSize) * 100}%` }}
                    />
                    <span className="text-[#22c55e] relative z-10 w-14 text-right">
                      {(b.price * 100).toFixed(1)}%
                    </span>
                    <span className="text-muted relative z-10 ml-auto">
                      ${b.size.toFixed(0)}
                    </span>
                  </div>
                ))}
                {(!orderbook.bids || orderbook.bids.length === 0) && (
                  <div className="text-muted/40 text-[10px]">No bids</div>
                )}
              </div>
              {/* Asks */}
              <div>
                <div className="text-muted mb-1.5 text-[10px] uppercase tracking-wide">
                  Asks
                </div>
                {(orderbook.asks ?? []).slice(0, 8).map((a, i) => (
                  <div key={`ask-${i}`} className="flex items-center gap-1 mb-0.5 relative">
                    <div
                      className="absolute inset-0 bg-[#ef4444]/8 rounded-sm right-0"
                      style={{ width: `${(a.size / maxAskSize) * 100}%` }}
                    />
                    <span className="text-[#ef4444] relative z-10 w-14 text-right">
                      {(a.price * 100).toFixed(1)}%
                    </span>
                    <span className="text-muted relative z-10 ml-auto">
                      ${a.size.toFixed(0)}
                    </span>
                  </div>
                ))}
                {(!orderbook.asks || orderbook.asks.length === 0) && (
                  <div className="text-muted/40 text-[10px]">No asks</div>
                )}
              </div>
            </div>
          </div>
        )}

        {detailTab === "info" && (
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted">Source</span>
              <span className="text-txt font-medium">
                {SOURCE_LABELS[parsed?.source ?? ""] ?? parsed?.source}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted">Chain</span>
              <span className="text-txt font-medium">
                {SOURCE_CHAINS[parsed?.source ?? ""] ?? "Unknown"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted">Condition ID</span>
              <span className="text-txt font-mono text-[10px] truncate max-w-[180px]">
                {market.conditionId}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted">Volume</span>
              <span className="text-txt font-mono">
                ${market.volume.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/30">
              <span className="text-muted">Spread</span>
              <span className="text-txt font-mono">
                {(spread * 100).toFixed(3)}%
              </span>
            </div>
            {market.endDate && (
              <div className="flex justify-between py-1 border-b border-border/30">
                <span className="text-muted">Resolution</span>
                <span className="text-txt">
                  {new Date(market.endDate).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trade form */}
      <div className="px-4 py-3 border-t border-border mt-auto bg-bg-hover/10">
        <div className="text-[10px] uppercase tracking-wide text-muted mb-2">
          Place Trade
        </div>

        {/* Side + Outcome in one row */}
        <div className="grid grid-cols-4 gap-1 mb-2">
          <button
            type="button"
            onClick={() => { setSide("buy"); setOutcome("yes"); }}
            className={`py-1.5 text-[11px] font-semibold rounded cursor-pointer transition-colors ${
              side === "buy" && outcome === "yes"
                ? "bg-[#22c55e] text-white"
                : "bg-bg-hover text-muted hover:text-txt"
            }`}
          >
            Buy YES
          </button>
          <button
            type="button"
            onClick={() => { setSide("buy"); setOutcome("no"); }}
            className={`py-1.5 text-[11px] font-semibold rounded cursor-pointer transition-colors ${
              side === "buy" && outcome === "no"
                ? "bg-[#ef4444] text-white"
                : "bg-bg-hover text-muted hover:text-txt"
            }`}
          >
            Buy NO
          </button>
          <button
            type="button"
            onClick={() => { setSide("sell"); setOutcome("yes"); }}
            className={`py-1.5 text-[11px] font-semibold rounded cursor-pointer transition-colors ${
              side === "sell" && outcome === "yes"
                ? "bg-[#22c55e]/60 text-white"
                : "bg-bg-hover text-muted hover:text-txt"
            }`}
          >
            Sell YES
          </button>
          <button
            type="button"
            onClick={() => { setSide("sell"); setOutcome("no"); }}
            className={`py-1.5 text-[11px] font-semibold rounded cursor-pointer transition-colors ${
              side === "sell" && outcome === "no"
                ? "bg-[#ef4444]/60 text-white"
                : "bg-bg-hover text-muted hover:text-txt"
            }`}
          >
            Sell NO
          </button>
        </div>

        {/* Amount + Limit price */}
        <div className="flex gap-2 mb-2">
          <div className="flex-1">
            <input
              type="number"
              placeholder="Amount (USD)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-txt placeholder:text-muted/50 focus:outline-none focus:border-accent"
              min="0"
              step="1"
            />
          </div>
          <div className="w-24">
            <input
              type="number"
              placeholder="Limit %"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-txt placeholder:text-muted/50 focus:outline-none focus:border-accent"
              min="0"
              max="100"
              step="0.1"
            />
          </div>
        </div>

        {/* Quick amount buttons */}
        <div className="flex gap-1 mb-2">
          {[1, 5, 10, 25].map((usd) => (
            <button
              key={usd}
              type="button"
              onClick={() => setAmount(String(usd))}
              className="flex-1 py-1 text-[10px] font-medium rounded bg-bg-hover text-muted hover:text-txt cursor-pointer transition-colors"
            >
              ${usd}
            </button>
          ))}
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={() => void handleTrade()}
          disabled={trading || !amount || Number(amount) <= 0}
          className={`w-full py-2 text-xs font-semibold rounded cursor-pointer transition-colors ${
            side === "buy"
              ? "bg-[#22c55e] hover:bg-[#16a34a] text-white"
              : "bg-[#ef4444] hover:bg-[#dc2626] text-white"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {trading
            ? "Placing..."
            : `${side === "buy" ? "Buy" : "Sell"} ${outcome.toUpperCase()} — $${amount || "0"}`}
        </button>

        {/* Trade result */}
        {tradeResult && (
          <div
            className={`mt-2 px-2 py-1.5 rounded text-[11px] ${
              tradeResult.ok
                ? tradeResult.dryRun
                  ? "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30"
                  : "bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30"
                : "bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/30"
            }`}
          >
            {tradeResult.message}
          </div>
        )}
      </div>
    </div>
  );
}
