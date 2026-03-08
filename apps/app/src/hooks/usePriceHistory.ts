import { useEffect, useRef, useState } from "react";
import { client } from "../api-client";

const MAX_HISTORY = 60; // Keep last 60 ticks (~5 min at 5s intervals)

/**
 * Tracks price history for sparklines by accumulating WS price updates.
 * Returns a map of tokenId → number[] (most recent last).
 */
export function usePriceHistory(): Map<string, number[]> {
  const [history, setHistory] = useState<Map<string, number[]>>(new Map());
  const histRef = useRef(history);

  useEffect(() => {
    const unsub = client.onWsEvent("limitless-prices", (data) => {
      const updates = data as Record<string, number>;
      const next = new Map(histRef.current);
      let changed = false;

      for (const [tokenId, price] of Object.entries(updates)) {
        if (typeof price !== "number") continue;
        const arr = next.get(tokenId) ?? [];
        // Only push if price actually changed
        if (arr.length === 0 || arr[arr.length - 1] !== price) {
          const updated = [...arr, price].slice(-MAX_HISTORY);
          next.set(tokenId, updated);
          changed = true;
        }
      }

      if (changed) {
        histRef.current = next;
        setHistory(next);
      }
    });
    return unsub;
  }, []);

  return history;
}
