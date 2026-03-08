/**
 * TraderShell — AI-powered prediction market trading dashboard.
 *
 * Renders when `uiShellMode === "trader"`. Four-panel layout:
 * Market List (left) | Market Detail (center) | Portfolio + Agent Copilot (right)
 * with a strategy controls bar at the bottom.
 *
 * Mobile: stacked with tab-based panel switching.
 */

import { useCallback, useEffect, useState } from "react";
import type { TradingSource } from "../api-client";
import { client } from "../api-client";
import type { Tab } from "../navigation";
import { Header } from "./Header";
import { Nav } from "./Nav";
import { AgentInsightPanel } from "./trader/AgentInsightPanel";
import { AlphaScanner } from "./trader/AlphaScanner";
import { MarketDetailPanel } from "./trader/MarketDetailPanel";
import { MarketListPanel } from "./trader/MarketListPanel";
import { PortfolioPanel } from "./trader/PortfolioPanel";
import { StrategyControlsBar } from "./trader/StrategyControlsBar";

interface TraderShellProps {
  tab: Tab;
  actionNotice?: { text: string; tone: string } | null;
}

const MOBILE_BREAKPOINT = 768;

type MobilePanel = "markets" | "detail" | "portfolio" | "alpha" | "agent";

export function TraderShell({ actionNotice }: TraderShellProps) {
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("markets");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sources, setSources] = useState<TradingSource[]>([]);
  const [wallets, setWallets] = useState<{ evm: boolean; solana: boolean }>({
    evm: false,
    solana: false,
  });
  const [agentCollapsed, setAgentCollapsed] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    client
      .getTradingSources()
      .then((res) => {
        setSources(res.sources);
        setWallets(res.wallets);
      })
      .catch(() => {
        /* silent */
      });
  }, []);

  const handleSelectMarket = useCallback(
    (id: string) => {
      setSelectedMarketId(id);
      if (isMobile) setMobilePanel("detail");
    },
    [isMobile],
  );

  const enabledSources = sources.filter((s) => s.enabled);

  return (
    <div className="flex flex-col h-screen w-screen min-h-0 font-body text-txt bg-bg overflow-hidden">
      <Header />
      <Nav />

      {/* Source filter + status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-hover/20 text-[11px]">
        <span className="text-muted font-medium uppercase tracking-wide mr-1">
          Source:
        </span>
        {[
          { id: "all", label: "All Markets" },
          ...enabledSources.map((s) => ({ id: s.id, label: s.name })),
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              setSourceFilter(opt.id);
              setSelectedMarketId(null);
            }}
            className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
              sourceFilter === opt.id
                ? "bg-accent/20 text-accent font-semibold"
                : "text-muted hover:text-txt hover:bg-bg-hover/50"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 text-muted">
          {wallets.evm && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] inline-block" />
              EVM
            </span>
          )}
          {wallets.solana && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] inline-block" />
              Solana
            </span>
          )}
          {!wallets.evm && !wallets.solana && (
            <span className="text-[#f59e0b]">No wallets</span>
          )}
        </div>
      </div>

      {/* Mobile tab bar */}
      {isMobile && (
        <div className="flex border-b border-border bg-bg">
          {(["markets", "detail", "alpha", "portfolio", "agent"] as const).map(
            (panel) => (
              <button
                key={panel}
                type="button"
                onClick={() => setMobilePanel(panel)}
                className={`flex-1 py-2 text-xs font-medium text-center cursor-pointer transition-colors ${
                  mobilePanel === panel
                    ? "text-accent border-b-2 border-accent"
                    : "text-muted hover:text-txt"
                }`}
              >
                {panel === "markets"
                  ? "Markets"
                  : panel === "detail"
                    ? "Trade"
                    : panel === "alpha"
                      ? "Alpha"
                      : panel === "portfolio"
                        ? "Portfolio"
                        : "Agent"}
              </button>
            ),
          )}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 min-h-0 relative">
        {isMobile ? (
          // Mobile: show one panel at a time
          <div className="flex-1 min-h-0 overflow-hidden">
            {mobilePanel === "markets" && (
              <MarketListPanel
                selectedMarketId={selectedMarketId}
                onSelectMarket={handleSelectMarket}
                sourceFilter={sourceFilter}
              />
            )}
            {mobilePanel === "detail" && (
              <MarketDetailPanel marketId={selectedMarketId} />
            )}
            {mobilePanel === "alpha" && (
              <AlphaScanner onSelectMarket={handleSelectMarket} />
            )}
            {mobilePanel === "portfolio" && <PortfolioPanel />}
            {mobilePanel === "agent" && <AgentInsightPanel />}
          </div>
        ) : (
          // Desktop: four-panel layout with collapsible agent
          <>
            <div className="w-[260px] xl:w-[300px] shrink-0 min-h-0 overflow-hidden">
              <MarketListPanel
                selectedMarketId={selectedMarketId}
                onSelectMarket={handleSelectMarket}
                sourceFilter={sourceFilter}
              />
            </div>
            <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
              {selectedMarketId ? (
                <MarketDetailPanel marketId={selectedMarketId} />
              ) : (
                <AlphaScanner onSelectMarket={handleSelectMarket} />
              )}
            </div>
            <div className="w-[240px] xl:w-[270px] shrink-0 min-h-0 overflow-hidden">
              <PortfolioPanel />
            </div>
            <AgentInsightPanel
              collapsed={agentCollapsed}
              onToggleCollapse={() => setAgentCollapsed(!agentCollapsed)}
            />
          </>
        )}
      </div>

      {/* Strategy controls */}
      <StrategyControlsBar />

      {/* Action notice toast */}
      {actionNotice && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2 rounded-lg text-[13px] font-medium z-[10000] text-white ${
            actionNotice.tone === "error"
              ? "bg-danger"
              : actionNotice.tone === "success"
                ? "bg-ok"
                : "bg-accent"
          }`}
        >
          {actionNotice.text}
        </div>
      )}
    </div>
  );
}
