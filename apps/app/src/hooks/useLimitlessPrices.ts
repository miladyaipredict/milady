import { useEffect, useRef, useState } from "react";
import { client } from "../api-client";

/**
 * Subscribe to real-time Limitless price updates via the existing WS connection.
 * Returns a map of tokenId → price that auto-updates on each `limitless-prices` event.
 */
export function useLimitlessPrices(): Map<string, number> {
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const pricesRef = useRef(prices);

  useEffect(() => {
    const unsub = client.onWsEvent("limitless-prices", (data) => {
      const updates = data as Record<string, number>;
      const next = new Map(pricesRef.current);
      let changed = false;
      for (const [tokenId, price] of Object.entries(updates)) {
        if (typeof price === "number" && next.get(tokenId) !== price) {
          next.set(tokenId, price);
          changed = true;
        }
      }
      if (changed) {
        pricesRef.current = next;
        setPrices(next);
      }
    });
    return unsub;
  }, []);

  return prices;
}
