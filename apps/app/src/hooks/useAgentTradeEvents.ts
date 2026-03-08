import { useEffect, useRef, useState } from "react";
import { client } from "../api-client";

export interface TradeEvent {
  id: string;
  ts: number;
  type: "thought" | "trade" | "alert" | "analysis" | "action";
  source?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

const MAX_EVENTS = 100;

/**
 * Subscribes to agent events and filters for trading-related activity.
 * Captures: thoughts about markets, trade executions, price alerts, analysis.
 */
export function useAgentTradeEvents(): TradeEvent[] {
  const [events, setEvents] = useState<TradeEvent[]>([]);
  const eventsRef = useRef(events);

  useEffect(() => {
    const push = (event: TradeEvent) => {
      const next = [event, ...eventsRef.current].slice(0, MAX_EVENTS);
      eventsRef.current = next;
      setEvents(next);
    };

    // Listen for agent events (thoughts, actions)
    const unsubAgent = client.onWsEvent("agent_event", (data) => {
      const d = data as Record<string, unknown>;
      const payload = (d.payload ?? d) as Record<string, unknown>;
      const stream = (d.stream ?? payload.stream ?? "") as string;
      const text = String(
        payload.text ?? payload.preview ?? payload.message ?? "",
      );

      if (!text) return;

      // Filter for trading-related content
      const tradingKeywords =
        /market|trade|position|predict|bet|buy|sell|yes|no|price|exposure|profit|loss|p&l|pnl|limitless|opinion|polymarket|strategy|signal|alpha|momentum|sentiment/i;

      if (!tradingKeywords.test(text) && stream !== "action") return;

      let type: TradeEvent["type"] = "thought";
      if (stream === "action" || stream === "tool") type = "action";
      else if (stream === "assistant" || stream === "evaluator") type = "analysis";

      push({
        id: String(d.eventId ?? `${Date.now()}-${Math.random()}`),
        ts: Number(d.ts ?? Date.now()),
        type,
        source: stream,
        text: text.slice(0, 500),
        metadata: payload,
      });
    });

    // Listen for trade execution results
    const unsubTrade = client.onWsEvent("limitless-trade", (data) => {
      const d = data as Record<string, unknown>;
      push({
        id: `trade-${Date.now()}`,
        ts: Date.now(),
        type: "trade",
        source: "limitless",
        text: d.dryRun
          ? `DRY RUN: ${d.side} ${d.outcome} $${d.amountUsd}`
          : `EXECUTED: ${d.side} ${d.outcome} $${d.amountUsd}`,
        metadata: d,
      });
    });

    // Listen for price alerts
    const unsubAlert = client.onWsEvent("limitless-alert", (data) => {
      const d = data as Record<string, unknown>;
      push({
        id: `alert-${Date.now()}`,
        ts: Date.now(),
        type: "alert",
        source: "limitless",
        text: String(d.message ?? d.text ?? "Price alert"),
        metadata: d,
      });
    });

    // Listen for proactive messages (agent speaking about trading)
    const unsubProactive = client.onWsEvent("proactive-message", (data) => {
      const d = data as Record<string, unknown>;
      const text = String(d.text ?? d.content ?? "");
      const tradingKeywords =
        /market|trade|position|predict|bet|price|exposure|profit|loss/i;
      if (tradingKeywords.test(text)) {
        push({
          id: `proactive-${Date.now()}`,
          ts: Date.now(),
          type: "analysis",
          source: "agent",
          text: text.slice(0, 500),
          metadata: d,
        });
      }
    });

    return () => {
      unsubAgent();
      unsubTrade();
      unsubAlert();
      unsubProactive();
    };
  }, []);

  return events;
}
