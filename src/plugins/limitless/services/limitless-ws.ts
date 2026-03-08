import WebSocket from "ws";
import { limitlessClient } from "../client.js";

const HEARTBEAT_INTERVAL_MS = 25_000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;
const PRICE_ALERT_THRESHOLD = 0.1; // 10% change
const PRICE_BROADCAST_INTERVAL_MS = 5_000;

/** Singleton reference so API layer can attach a broadcast callback. */
let activeSvc: LimitlessWsService | null = null;
export function getLimitlessWsService(): LimitlessWsService | null {
  return activeSvc;
}

export class LimitlessWsService {
  static serviceType = "limitless-ws" as const;

  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private priceBroadcastTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_MS;
  private stopped = false;
  private lastPricesMap = new Map<string, number>();
  private broadcastFn: ((data: Record<string, unknown>) => void) | null = null;

  static async start(
    _runtime: unknown,
  ): Promise<LimitlessWsService> {
    const svc = new LimitlessWsService();
    activeSvc = svc;
    svc.connect();
    svc.startPriceBroadcast();
    return svc;
  }

  /** Attach a WS broadcast function (typically state.broadcastWs from the API server). */
  setBroadcast(fn: (data: Record<string, unknown>) => void): void {
    this.broadcastFn = fn;
  }

  getLastPrices(): Map<string, number> {
    return new Map(this.lastPricesMap);
  }

  private connect(): void {
    if (this.stopped) return;
    if (!limitlessClient.isReady) {
      this.scheduleReconnect();
      return;
    }

    try {
      this.ws = new WebSocket("wss://ws.limitless.exchange", {
        headers: { Authorization: `Bearer ${process.env.LIMITLESS_API_KEY ?? ""}` },
      });

      this.ws.on("open", () => {
        console.info("[limitless-ws] Connected");
        this.reconnectDelayMs = RECONNECT_BASE_MS;
        this.startHeartbeat();
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch {
          // ignore malformed messages
        }
      });

      this.ws.on("close", () => {
        console.info("[limitless-ws] Disconnected");
        this.cleanup();
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        console.warn("[limitless-ws] Error:", err.message);
        this.ws?.close();
      });
    } catch (err) {
      console.warn("[limitless-ws] Connection failed:", err);
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: { type?: string; tokenId?: string; price?: number }): void {
    if (msg.type === "price" && msg.tokenId && typeof msg.price === "number") {
      const prevPrice = this.lastPricesMap.get(msg.tokenId);
      this.lastPricesMap.set(msg.tokenId, msg.price);

      if (prevPrice != null && prevPrice > 0) {
        const change = Math.abs(msg.price - prevPrice) / prevPrice;
        if (change >= PRICE_ALERT_THRESHOLD) {
          console.info(
            `[limitless-ws] Price alert: ${msg.tokenId} ${(change * 100).toFixed(1)}% change (${prevPrice.toFixed(4)} → ${msg.price.toFixed(4)})`,
          );
        }
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);

    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      RECONNECT_MAX_MS,
    );
  }

  private startPriceBroadcast(): void {
    this.stopPriceBroadcast();
    this.priceBroadcastTimer = setInterval(() => {
      if (this.broadcastFn && this.lastPricesMap.size > 0) {
        const prices: Record<string, number> = {};
        for (const [k, v] of this.lastPricesMap) {
          prices[k] = v;
        }
        this.broadcastFn({ type: "limitless-prices", prices });
      }
    }, PRICE_BROADCAST_INTERVAL_MS);
  }

  private stopPriceBroadcast(): void {
    if (this.priceBroadcastTimer) {
      clearInterval(this.priceBroadcastTimer);
      this.priceBroadcastTimer = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
    this.stopPriceBroadcast();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (activeSvc === this) {
      activeSvc = null;
    }
  }
}
