import { useCallback, useEffect, useState } from "react";
import type { LimitlessStrategy } from "../../api-client";
import { client } from "../../api-client";

export function StrategyControlsBar() {
  const [strategies, setStrategies] = useState<LimitlessStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await client.getLimitlessStrategies();
      setStrategies(res.strategies);
    } catch {
      // Strategies endpoint may not be available yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStrategies();
    const interval = setInterval(() => void fetchStrategies(), 15_000);
    return () => clearInterval(interval);
  }, [fetchStrategies]);

  const handleToggle = useCallback(
    async (id: string) => {
      setTogglingId(id);
      try {
        const res = await client.toggleLimitlessStrategy(id);
        setStrategies((prev) =>
          prev.map((s) => (s.id === id ? { ...s, running: res.running } : s)),
        );
      } catch {
        // ignore
      } finally {
        setTogglingId(null);
      }
    },
    [],
  );

  if (loading || strategies.length === 0) return null;

  return (
    <div className="border-t border-border bg-bg-hover/20 px-3 py-2">
      <div className="flex items-center gap-3 overflow-x-auto">
        <span className="text-[10px] uppercase tracking-wide text-muted shrink-0">
          Strategies
        </span>
        {strategies.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => void handleToggle(s.id)}
            disabled={togglingId === s.id}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-all shrink-0 ${
              s.running
                ? "bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30"
                : "bg-bg-hover text-muted border border-border hover:border-accent hover:text-accent"
            } disabled:opacity-50`}
            title={s.description}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                s.running ? "bg-[#22c55e] animate-pulse" : "bg-muted/40"
              }`}
            />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
