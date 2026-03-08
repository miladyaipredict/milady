import { useEffect, useRef, useState } from "react";
import { client } from "../../api-client";
import {
  type TradeEvent,
  useAgentTradeEvents,
} from "../../hooks/useAgentTradeEvents";

const TYPE_STYLES: Record<
  TradeEvent["type"],
  { bg: string; border: string; label: string; icon: string }
> = {
  thought: {
    bg: "bg-yellow-500/5",
    border: "border-yellow-500/30",
    label: "Thinking",
    icon: "brain",
  },
  trade: {
    bg: "bg-[#22c55e]/5",
    border: "border-[#22c55e]/30",
    label: "Trade",
    icon: "zap",
  },
  alert: {
    bg: "bg-[#f59e0b]/5",
    border: "border-[#f59e0b]/30",
    label: "Alert",
    icon: "bell",
  },
  analysis: {
    bg: "bg-[#3b82f6]/5",
    border: "border-[#3b82f6]/30",
    label: "Analysis",
    icon: "search",
  },
  action: {
    bg: "bg-[#a855f7]/5",
    border: "border-[#a855f7]/30",
    label: "Action",
    icon: "play",
  },
};

function formatTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

interface AgentInsightPanelProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function AgentInsightPanel({
  collapsed = false,
  onToggleCollapse,
}: AgentInsightPanelProps) {
  const events = useAgentTradeEvents();
  const [filter, setFilter] = useState<TradeEvent["type"] | "all">("all");
  const [autonomyEnabled, setAutonomyEnabled] = useState(false);
  const [agentThinking, setAgentThinking] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  // Check autonomy status
  useEffect(() => {
    const check = async () => {
      try {
        const res = await client.fetch("/api/agent/autonomy") as {
          enabled?: boolean;
          thinking?: boolean;
        };
        setAutonomyEnabled(res.enabled ?? false);
        setAgentThinking(res.thinking ?? false);
      } catch {
        // ignore
      }
    };
    void check();
    const interval = setInterval(() => void check(), 10_000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll on new events
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const filtered =
    filter === "all" ? events : events.filter((e) => e.type === filter);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 w-10 border-l border-border bg-bg-hover/10">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-muted hover:text-accent cursor-pointer mb-3"
          title="Expand Agent Insights"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        {/* Status indicator */}
        <div
          className={`w-2 h-2 rounded-full mb-2 ${
            agentThinking
              ? "bg-yellow-500 animate-pulse"
              : autonomyEnabled
                ? "bg-[#22c55e]"
                : "bg-muted/30"
          }`}
          title={
            agentThinking
              ? "Agent thinking..."
              : autonomyEnabled
                ? "Agent active"
                : "Agent idle"
          }
        />
        {events.length > 0 && (
          <span className="text-[9px] text-muted font-mono">
            {events.length}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-[280px] xl:w-[320px] border-l border-border bg-bg shrink-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-bg-hover/30 flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            agentThinking
              ? "bg-yellow-500 animate-pulse"
              : autonomyEnabled
                ? "bg-[#22c55e] animate-pulse"
                : "bg-muted/30"
          }`}
        />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted flex-1">
          Agent Copilot
        </h2>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-muted hover:text-accent cursor-pointer"
            title="Collapse"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>

      {/* Agent status bar */}
      <div className="px-3 py-1.5 border-b border-border/50 flex items-center gap-2 text-[10px]">
        <span
          className={`px-1.5 py-0.5 rounded font-medium ${
            autonomyEnabled
              ? "bg-[#22c55e]/15 text-[#22c55e]"
              : "bg-muted/10 text-muted"
          }`}
        >
          {autonomyEnabled ? "Autonomous" : "Manual"}
        </span>
        {agentThinking && (
          <span className="text-yellow-500 animate-pulse">Analyzing...</span>
        )}
        <span className="ml-auto text-muted">
          {events.length} events
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0.5 px-2 py-1.5 border-b border-border/50 overflow-x-auto">
        {(
          ["all", "thought", "analysis", "trade", "alert", "action"] as const
        ).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors whitespace-nowrap ${
              filter === t
                ? "bg-accent/20 text-accent"
                : "text-muted/60 hover:text-muted hover:bg-bg-hover/50"
            }`}
          >
            {t === "all" ? "All" : TYPE_STYLES[t].label}
          </button>
        ))}
      </div>

      {/* Event feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted">
            <div className="text-lg mb-2 opacity-30">
              {autonomyEnabled ? "Listening..." : "Agent idle"}
            </div>
            <p className="leading-relaxed">
              {autonomyEnabled
                ? "The agent is monitoring markets. Trading thoughts and actions will appear here."
                : "Enable autonomy to let the agent analyze markets and suggest trades."}
            </p>
          </div>
        ) : (
          filtered.map((event) => {
            const style = TYPE_STYLES[event.type];
            return (
              <div
                key={event.id}
                className={`px-3 py-2 border-b border-border/20 ${style.bg} hover:brightness-105 transition-all`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded ${style.border} border`}
                  >
                    {style.label}
                  </span>
                  {event.source && (
                    <span className="text-[9px] text-muted/50">
                      {event.source}
                    </span>
                  )}
                  <span className="text-[9px] text-muted/40 ml-auto">
                    {formatTimeAgo(event.ts)}
                  </span>
                </div>
                <p className="text-[11px] text-txt/80 leading-relaxed line-clamp-4">
                  {event.text}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
