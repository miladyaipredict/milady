import { useCallback, useEffect, useState } from "react";
import type { UnifiedMarket } from "../../api-client";
import { client } from "../../api-client";
import { useLimitlessPrices } from "../../hooks/useLimitlessPrices";
import { usePriceHistory } from "../../hooks/usePriceHistory";
import { PriceSparkline } from "./PriceSparkline";

interface MarketListPanelProps {
  selectedMarketId: string | null;
  onSelectMarket: (id: string) => void;
  sourceFilter?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  limitless: "#3b82f6",
  opinion: "#f59e0b",
  polymarket: "#a855f7",
};

type SortMode = "volume" | "trending" | "newest";

export function MarketListPanel({
  selectedMarketId,
  onSelectMarket,
  sourceFilter = "all",
}: MarketListPanelProps) {
  const [markets, setMarkets] = useState<UnifiedMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("volume");
  const livePrices = useLimitlessPrices();
  const priceHistory = usePriceHistory();

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.getTradingMarkets(sourceFilter);
      setMarkets(res.markets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load markets");
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    void fetchMarkets();
  }, [fetchMarkets]);

  const getPrice = (market: UnifiedMarket, outcome: "yes" | "no") => {
    if (market.source === "limitless") {
      const live = livePrices.get(`${market.sourceId}-${outcome}`);
      if (live != null) return live;
    }
    return outcome === "yes" ? market.yesPrice : market.noPrice;
  };

  // Calculate price change from history for trending sort
  const getPriceChange = (market: UnifiedMarket): number => {
    if (market.source !== "limitless") return 0;
    const hist = priceHistory.get(`${market.sourceId}-yes`);
    if (!hist || hist.length < 2) return 0;
    const first = hist[0];
    const last = hist[hist.length - 1];
    return first > 0 ? (last - first) / first : 0;
  };

  // Filter and sort
  const filteredMarkets = markets
    .filter((m) => {
      if (!search) return true;
      return m.title.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      if (sortMode === "trending") {
        return Math.abs(getPriceChange(b)) - Math.abs(getPriceChange(a));
      }
      if (sortMode === "newest") {
        return (b.endDate || "").localeCompare(a.endDate || "");
      }
      return b.volume - a.volume;
    });

  return (
    <div className="flex flex-col h-full border-r border-border">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-bg-hover/30">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Markets
            {filteredMarkets.length > 0 && (
              <span className="ml-1.5 font-normal text-muted/60">
                {filteredMarkets.length}
              </span>
            )}
          </h2>
          <div className="flex gap-0.5">
            {(["volume", "trending", "newest"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors ${
                  sortMode === mode
                    ? "bg-accent/20 text-accent"
                    : "text-muted/50 hover:text-muted"
                }`}
              >
                {mode === "volume" ? "Vol" : mode === "trending" ? "Hot" : "New"}
              </button>
            ))}
          </div>
        </div>
        {/* Search */}
        <input
          type="text"
          placeholder="Search markets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1 text-[11px] bg-bg border border-border/60 rounded text-txt placeholder:text-muted/40 focus:outline-none focus:border-accent/50"
        />
      </div>

      {/* Market list */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-3 py-4 text-xs text-danger">{error}</div>
        )}

        {filteredMarkets.map((m) => {
          const yesPrice = getPrice(m, "yes");
          const noPrice = getPrice(m, "no");
          const isSelected = selectedMarketId === m.id;
          const sourceColor = SOURCE_COLORS[m.source] ?? "#888";
          const change = getPriceChange(m);
          const changeStr =
            change !== 0
              ? `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`
              : null;
          const yesPriceHistory =
            m.source === "limitless"
              ? (priceHistory.get(`${m.sourceId}-yes`) ?? [])
              : [];

          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectMarket(m.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-border/50 cursor-pointer transition-colors ${
                isSelected
                  ? "bg-accent/10 border-l-2 border-l-accent"
                  : "hover:bg-bg-hover/50"
              }`}
            >
              <div className="flex items-start gap-2 mb-1">
                <span
                  className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: sourceColor }}
                  title={m.source}
                />
                <div className="text-[13px] font-medium text-txt leading-tight line-clamp-2 flex-1 min-w-0">
                  {m.title}
                </div>
                {yesPriceHistory.length >= 3 && (
                  <PriceSparkline
                    data={yesPriceHistory}
                    width={48}
                    height={18}
                    color={change >= 0 ? "#22c55e" : "#ef4444"}
                  />
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] pl-3.5">
                <span className="text-[#22c55e] font-mono font-medium">
                  Y {(yesPrice * 100).toFixed(1)}%
                </span>
                <span className="text-[#ef4444] font-mono font-medium">
                  N {(noPrice * 100).toFixed(1)}%
                </span>
                {changeStr && (
                  <span
                    className={`text-[10px] font-mono font-bold ${
                      change > 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                    }`}
                  >
                    {changeStr}
                  </span>
                )}
                <span className="text-muted ml-auto text-[10px] uppercase">
                  {m.source.slice(0, 3)}
                </span>
                <span className="text-muted font-mono">
                  ${m.volume >= 1000 ? `${(m.volume / 1000).toFixed(1)}k` : m.volume.toFixed(0)}
                </span>
              </div>
            </button>
          );
        })}

        {loading && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            Loading markets...
          </div>
        )}

        {!loading && filteredMarkets.length === 0 && !error && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            {search
              ? "No markets match your search."
              : "No markets found. Configure prediction market plugins (LIMITLESS_API_KEY, OPINION_API_KEY, or CLOB_API_KEY)."}
          </div>
        )}
      </div>
    </div>
  );
}
