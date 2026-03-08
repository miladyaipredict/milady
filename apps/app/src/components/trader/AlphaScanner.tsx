import { useCallback, useEffect, useState } from "react";
import type { AlphaOpportunity, AlphaScanResult } from "../../api-client";
import { client } from "../../api-client";

interface AlphaScannerProps {
  onSelectMarket?: (marketId: string) => void;
}

const SIGNAL_STYLES: Record<
  AlphaOpportunity["signal"],
  { color: string; bg: string; label: string }
> = {
  mispriced: { color: "#22c55e", bg: "bg-[#22c55e]/10", label: "Mispriced" },
  momentum: { color: "#3b82f6", bg: "bg-[#3b82f6]/10", label: "Momentum" },
  contrarian: { color: "#f59e0b", bg: "bg-[#f59e0b]/10", label: "Contrarian" },
  arbitrage: { color: "#a855f7", bg: "bg-[#a855f7]/10", label: "Arbitrage" },
  "event-driven": { color: "#ef4444", bg: "bg-[#ef4444]/10", label: "Event" },
  niche: { color: "#06b6d4", bg: "bg-[#06b6d4]/10", label: "Niche" },
};

const RISK_STYLES: Record<string, string> = {
  low: "text-[#22c55e]",
  medium: "text-[#f59e0b]",
  high: "text-[#ef4444]",
};

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 70 ? "#22c55e" : value >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 bg-bg-hover rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-mono" style={{ color }}>
        {value}%
      </span>
    </div>
  );
}

export function AlphaScanner({ onSelectMarket }: AlphaScannerProps) {
  const [result, setResult] = useState<AlphaScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Load cached results on mount
  useEffect(() => {
    client
      .getAlphaScan()
      .then((res) => {
        setResult(res.result);
        setScanning(res.scanning);
      })
      .catch(() => {});
  }, []);

  // Poll while scanning
  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(async () => {
      try {
        const res = await client.getAlphaScan();
        if (!res.scanning) {
          setScanning(false);
          setResult(res.result);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [scanning]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await client.runAlphaScan();
      setResult(res.result);
      setScanning(res.scanning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setScanning(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-bg-hover/30">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-semibold text-txt">
              Alpha Scanner
            </h2>
            <p className="text-[10px] text-muted mt-0.5">
              AI-powered market analysis using your connected model
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleScan()}
            disabled={scanning}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-all ${
              scanning
                ? "bg-accent/20 text-accent animate-pulse"
                : "bg-accent text-white hover:bg-accent/80"
            } disabled:cursor-not-allowed`}
          >
            {scanning ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                Scanning...
              </span>
            ) : (
              "Scan Markets"
            )}
          </button>
        </div>

        {/* Scan metadata */}
        {result && !scanning && (
          <div className="flex items-center gap-3 text-[10px] text-muted">
            <span>{result.marketsSurveyed} markets surveyed</span>
            <span>{result.opportunities.length} opportunities</span>
            <span>{(result.scanDurationMs / 1000).toFixed(1)}s</span>
            <span className="ml-auto">
              {new Date(result.timestamp).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-danger bg-danger/5 border-b border-danger/20">
          {error}
        </div>
      )}

      {/* Summary */}
      {result?.summary && !scanning && (
        <div className="px-4 py-2.5 border-b border-border/50 bg-accent/5">
          <p className="text-[11px] text-txt/80 leading-relaxed italic">
            {result.summary}
          </p>
        </div>
      )}

      {/* Opportunities */}
      <div className="flex-1 overflow-y-auto">
        {scanning && !result && (
          <div className="px-4 py-12 text-center">
            <div className="inline-flex items-center gap-2 text-accent text-sm">
              <span className="w-3 h-3 rounded-full bg-accent/30 animate-ping" />
              Agent analyzing markets...
            </div>
            <p className="text-[11px] text-muted mt-2">
              Your connected model is scanning for mispriced outcomes,
              momentum plays, and niche opportunities.
            </p>
          </div>
        )}

        {!scanning && result && result.opportunities.length === 0 && (
          <div className="px-4 py-12 text-center text-muted">
            <div className="text-lg mb-2 opacity-20">No opportunities found</div>
            <p className="text-[11px]">
              The agent found no exploitable edges right now. Markets may be
              efficiently priced, or there aren't enough markets to analyze.
            </p>
          </div>
        )}

        {!scanning && !result && (
          <div className="px-4 py-12 text-center text-muted">
            <div className="text-lg mb-2 opacity-20">Ready to scan</div>
            <p className="text-[11px] leading-relaxed max-w-xs mx-auto">
              Click "Scan Markets" to have the agent analyze all active
              prediction markets and surface niche opportunities.
            </p>
          </div>
        )}

        {result?.opportunities.map((opp) => {
          const style = SIGNAL_STYLES[opp.signal] ?? SIGNAL_STYLES.niche;
          const isExpanded = expanded === `${opp.source}-${opp.marketId}`;
          const riskClass = RISK_STYLES[opp.riskLevel] ?? "text-muted";

          return (
            <div
              key={`${opp.source}-${opp.marketId}`}
              className={`border-b border-border/30 transition-colors ${
                isExpanded ? style.bg : "hover:bg-bg-hover/30"
              }`}
            >
              {/* Main row */}
              <button
                type="button"
                onClick={() =>
                  setExpanded(
                    isExpanded ? null : `${opp.source}-${opp.marketId}`,
                  )
                }
                className="w-full text-left px-4 py-3 cursor-pointer"
              >
                <div className="flex items-start gap-2 mb-1.5">
                  <span
                    className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 mt-0.5"
                    style={{
                      color: style.color,
                      borderColor: style.color + "40",
                      backgroundColor: style.color + "10",
                    }}
                  >
                    {style.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-txt leading-tight line-clamp-2">
                      {opp.title}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px] mt-1">
                  <span
                    className={`font-bold ${
                      opp.suggestedSide === "yes"
                        ? "text-[#22c55e]"
                        : "text-[#ef4444]"
                    }`}
                  >
                    {opp.suggestedSide.toUpperCase()}
                  </span>
                  <span className="text-muted font-mono">
                    {(opp.currentPrice * 100).toFixed(1)}% &rarr;{" "}
                    {(opp.fairValue * 100).toFixed(1)}%
                  </span>
                  <span
                    className="font-bold font-mono"
                    style={{ color: style.color }}
                  >
                    +{opp.edge.toFixed(1)}% edge
                  </span>
                  <ConfidenceBar value={opp.confidence} />
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-3 space-y-2">
                  <p className="text-[11px] text-txt/70 leading-relaxed">
                    {opp.reasoning}
                  </p>

                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="bg-bg/50 rounded px-2 py-1.5">
                      <div className="text-muted mb-0.5">Risk</div>
                      <div className={`font-semibold ${riskClass}`}>
                        {opp.riskLevel.toUpperCase()}
                      </div>
                    </div>
                    <div className="bg-bg/50 rounded px-2 py-1.5">
                      <div className="text-muted mb-0.5">Size</div>
                      <div className="text-txt font-mono font-semibold">
                        ${opp.suggestedSize}
                      </div>
                    </div>
                    <div className="bg-bg/50 rounded px-2 py-1.5">
                      <div className="text-muted mb-0.5">Timeframe</div>
                      <div className="text-txt font-semibold">
                        {opp.timeframe}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    {onSelectMarket && (
                      <button
                        type="button"
                        onClick={() =>
                          onSelectMarket(`${opp.source}-${opp.marketId}`)
                        }
                        className="flex-1 py-1.5 text-[11px] font-semibold rounded bg-accent/20 text-accent hover:bg-accent/30 cursor-pointer transition-colors"
                      >
                        View Market
                      </button>
                    )}
                    <button
                      type="button"
                      className="flex-1 py-1.5 text-[11px] font-semibold rounded bg-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/30 cursor-pointer transition-colors"
                      onClick={() => {
                        if (onSelectMarket) {
                          onSelectMarket(`${opp.source}-${opp.marketId}`);
                        }
                      }}
                    >
                      Trade {opp.suggestedSide.toUpperCase()} ${opp.suggestedSize}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
