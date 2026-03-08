import { useCallback, useEffect, useState } from "react";
import type { TradingSource, UnifiedPosition } from "../../api-client";
import { client } from "../../api-client";

const SOURCE_COLORS: Record<string, string> = {
  limitless: "#3b82f6",
  opinion: "#f59e0b",
  polymarket: "#a855f7",
};

const SOURCE_LABELS: Record<string, string> = {
  limitless: "LMT",
  opinion: "OPN",
  polymarket: "PLY",
};

type PortfolioTab = "positions" | "wallets";

export function PortfolioPanel() {
  const [positions, setPositions] = useState<UnifiedPosition[]>([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PortfolioTab>("positions");

  // Exposure
  const [exposure, setExposure] = useState<{
    totalExposureUsd: number;
    remainingBudgetUsd: number;
    maxTotalExposureUsd: number;
    maxSingleTradeUsd: number;
    positionCount: number;
  } | null>(null);

  // Sources + wallets
  const [sources, setSources] = useState<TradingSource[]>([]);
  const [walletStatus, setWalletStatus] = useState<
    { chain: string; configured: boolean; address?: string }[]
  >([]);

  const fetchData = useCallback(async () => {
    try {
      const [posRes, expRes, srcRes, walRes] = await Promise.allSettled([
        client.getTradingPositions(),
        client.getLimitlessExposure(),
        client.getTradingSources(),
        client.getTradingWalletStatus(),
      ]);
      if (posRes.status === "fulfilled") {
        setPositions(posRes.value.positions);
        setTotalPnl(posRes.value.totalPnl);
      }
      if (expRes.status === "fulfilled") {
        setExposure(expRes.value as typeof exposure);
      }
      if (srcRes.status === "fulfilled") {
        setSources(srcRes.value.sources);
      }
      if (walRes.status === "fulfilled") {
        setWalletStatus(walRes.value.wallets);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const pnlColor =
    totalPnl > 0
      ? "text-[#22c55e]"
      : totalPnl < 0
        ? "text-[#ef4444]"
        : "text-muted";

  const exposurePercent = exposure
    ? Math.min(
        100,
        (exposure.totalExposureUsd / exposure.maxTotalExposureUsd) * 100,
      )
    : 0;
  const exposureColor =
    exposurePercent > 80
      ? "#ef4444"
      : exposurePercent > 50
        ? "#f59e0b"
        : "#22c55e";

  // Position allocation by source
  const sourceAlloc = positions.reduce<Record<string, number>>((acc, p) => {
    acc[p.source] = (acc[p.source] ?? 0) + Math.abs(p.pnl);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full border-l border-border">
      <div className="px-3 py-2 border-b border-border bg-bg-hover/30">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Portfolio
        </h2>
      </div>

      {/* Exposure meter - redesigned */}
      {exposure && (
        <div className="px-3 py-2.5 border-b border-border/50">
          <div className="flex justify-between text-[10px] text-muted mb-1.5">
            <span>Exposure</span>
            <span className="font-mono">
              ${exposure.totalExposureUsd.toFixed(0)} / ${exposure.maxTotalExposureUsd}
            </span>
          </div>
          {/* Circular-style gauge represented as stacked bar */}
          <div className="h-2 bg-bg-hover rounded-full overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${exposurePercent}%`,
                backgroundColor: exposureColor,
              }}
            />
            {/* Warning marker at 80% */}
            <div
              className="absolute top-0 bottom-0 w-px bg-muted/30"
              style={{ left: "80%" }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-muted/50 mt-1">
            <span>{exposure.positionCount} positions</span>
            <span>Max trade: ${exposure.maxSingleTradeUsd}</span>
          </div>
        </div>
      )}

      {/* P&L summary */}
      <div className="px-3 py-2.5 border-b border-border/50">
        <div className="flex justify-between items-center">
          <span className="text-[10px] uppercase tracking-wide text-muted">
            Total P&L
          </span>
          <span className={`text-base font-mono font-bold ${pnlColor}`}>
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </span>
        </div>
        {/* Source allocation mini-bar */}
        {positions.length > 0 && (
          <div className="flex gap-0.5 mt-2 h-1 rounded-full overflow-hidden">
            {Object.entries(sourceAlloc).map(([src, _val]) => {
              const srcPositions = positions.filter((p) => p.source === src);
              const pct = (srcPositions.length / positions.length) * 100;
              return (
                <div
                  key={src}
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: SOURCE_COLORS[src] ?? "#888",
                    minWidth: 4,
                  }}
                  title={`${src}: ${srcPositions.length} positions`}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border/50">
        {(["positions", "wallets"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[10px] font-medium cursor-pointer border-b-2 transition-colors ${
              tab === t
                ? "text-accent border-accent"
                : "text-muted border-transparent hover:text-txt"
            }`}
          >
            {t === "positions" ? "Positions" : "Wallets & Sources"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "positions" && (
          <>
            {loading && (
              <div className="px-3 py-6 text-xs text-muted text-center">
                Loading positions...
              </div>
            )}

            {error && (
              <div className="px-3 py-4 text-xs text-danger">{error}</div>
            )}

            {!loading && positions.length === 0 && !error && (
              <div className="px-3 py-6 text-xs text-muted text-center">
                No open positions
              </div>
            )}

            {positions.map((pos) => {
              const posColor =
                pos.pnl > 0
                  ? "text-[#22c55e]"
                  : pos.pnl < 0
                    ? "text-[#ef4444]"
                    : "text-muted";
              const outcomeColor =
                pos.outcome === "yes" ? "text-[#22c55e]" : "text-[#ef4444]";
              const sourceLabel = SOURCE_LABELS[pos.source] ?? pos.source;
              const sourceColor = SOURCE_COLORS[pos.source] ?? "#888";

              return (
                <div
                  key={`${pos.source}-${pos.marketId}-${pos.outcome}`}
                  className="px-3 py-2.5 border-b border-border/30 hover:bg-bg-hover/30 transition-colors"
                >
                  <div className="flex items-start gap-1.5 mb-1">
                    <span
                      className="text-[9px] font-bold text-white px-1 py-0.5 rounded shrink-0 mt-0.5"
                      style={{ backgroundColor: sourceColor }}
                    >
                      {sourceLabel}
                    </span>
                    <div className="text-[12px] font-medium text-txt leading-tight line-clamp-2">
                      {pos.marketTitle}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`font-semibold ${outcomeColor}`}>
                      {pos.outcome.toUpperCase()}
                    </span>
                    <span className="text-muted font-mono">
                      {pos.shares.toFixed(1)} @ {(pos.avgEntryPrice * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[11px]">
                    <span className="text-muted">
                      Now: {(pos.currentPrice * 100).toFixed(1)}%
                    </span>
                    <span className={`font-mono font-bold ${posColor}`}>
                      {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === "wallets" && (
          <div className="px-3 py-2 space-y-3">
            {/* Wallets */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted mb-2">
                Wallets
              </div>
              {walletStatus.map((w) => (
                <div
                  key={w.chain}
                  className="flex items-center gap-2 py-1.5 border-b border-border/20"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      w.configured ? "bg-[#22c55e]" : "bg-muted/30"
                    }`}
                  />
                  <span className="text-[11px] text-txt flex-1">{w.chain}</span>
                  {w.address && (
                    <span className="text-[10px] font-mono text-muted truncate max-w-[120px]">
                      {w.address.slice(0, 6)}...{w.address.slice(-4)}
                    </span>
                  )}
                  {!w.configured && (
                    <span className="text-[10px] text-muted/50">
                      Not configured
                    </span>
                  )}
                </div>
              ))}
              {walletStatus.length === 0 && (
                <div className="text-[11px] text-muted/50">Loading...</div>
              )}
            </div>

            {/* Sources */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted mb-2">
                Market Sources
              </div>
              {sources.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 py-1.5 border-b border-border/20"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: s.enabled
                        ? (SOURCE_COLORS[s.id] ?? "#22c55e")
                        : "rgba(128,128,128,0.3)",
                    }}
                  />
                  <span className="text-[11px] text-txt flex-1">{s.name}</span>
                  <span className="text-[10px] text-muted">{s.chain}</span>
                  <span
                    className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                      s.canTrade
                        ? "bg-[#22c55e]/15 text-[#22c55e]"
                        : s.enabled
                          ? "bg-[#f59e0b]/15 text-[#f59e0b]"
                          : "bg-muted/10 text-muted/50"
                    }`}
                  >
                    {s.canTrade ? "Trading" : s.enabled ? "Read-only" : "Off"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
