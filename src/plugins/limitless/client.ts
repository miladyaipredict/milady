import { ethers } from "ethers";
import { signOrder } from "./eip712.js";
import { exposureTracker } from "./exposure.js";
import type {
  LimitlessMarket,
  LimitlessOrder,
  LimitlessOrderbook,
  LimitlessPluginConfig,
  LimitlessPosition,
} from "./types.js";

const DEFAULT_API_URL = "https://api.limitless.exchange";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function retry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** i));
      }
    }
  }
  throw lastError;
}

class LimitlessClient {
  private apiKey = "";
  private apiUrl = DEFAULT_API_URL;
  private wallet: ethers.Wallet | null = null;
  private _dryRun = true;
  private _ready = false;

  get isReady(): boolean {
    return this._ready;
  }

  get canTrade(): boolean {
    return this._ready && this.wallet !== null;
  }

  get isDryRun(): boolean {
    return this._dryRun;
  }

  initialize(config: LimitlessPluginConfig): void {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || DEFAULT_API_URL;
    this._dryRun = config.dryRun;

    exposureTracker.configure(
      config.maxSingleTradeUsd,
      config.maxTotalExposureUsd,
    );

    if (config.privateKey) {
      try {
        const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
        this.wallet = new ethers.Wallet(config.privateKey, provider);
      } catch (err) {
        console.error("[limitless] Invalid private key:", err);
      }
    }

    this._ready = true;
    console.info(
      `[limitless] Initialized: dryRun=${this._dryRun}, canTrade=${this.canTrade}, api=${this.apiUrl}`,
    );
  }

  // ── HTTP helpers ────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    return retry(async () => {
      const res = await fetch(`${this.apiUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`Limitless API ${res.status}: ${await res.text()}`);
      }
      return res.json() as Promise<T>;
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return retry(async () => {
      const res = await fetch(`${this.apiUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Limitless API ${res.status}: ${await res.text()}`);
      }
      return res.json() as Promise<T>;
    });
  }

  // ── Read methods ────────────────────────────────────────────────────

  async getMarkets(): Promise<LimitlessMarket[]> {
    return this.get<LimitlessMarket[]>("/v1/markets");
  }

  async getMarket(id: string): Promise<LimitlessMarket> {
    return this.get<LimitlessMarket>(`/v1/markets/${encodeURIComponent(id)}`);
  }

  async getOrderbook(conditionId: string): Promise<LimitlessOrderbook> {
    return this.get<LimitlessOrderbook>(
      `/v1/orderbook/${encodeURIComponent(conditionId)}`,
    );
  }

  // ── User methods ────────────────────────────────────────────────────

  async getPositions(): Promise<LimitlessPosition[]> {
    if (!this.canTrade) return [];
    return this.get<LimitlessPosition[]>("/v1/positions");
  }

  async getOrders(): Promise<LimitlessOrder[]> {
    if (!this.canTrade) return [];
    return this.get<LimitlessOrder[]>("/v1/orders");
  }

  // ── Trade methods ───────────────────────────────────────────────────

  async placeTrade(params: {
    conditionId: string;
    side: "buy" | "sell";
    outcome: "yes" | "no";
    amountUsd: number;
    price?: number;
  }): Promise<{ ok: boolean; dryRun: boolean; order?: unknown; error?: string }> {
    const check = exposureTracker.canTrade(params.amountUsd);
    if (!check.allowed) {
      return { ok: false, dryRun: this._dryRun, error: check.reason };
    }

    if (this._dryRun) {
      console.info("[limitless] DRY RUN trade:", JSON.stringify(params));
      exposureTracker.recordTrade(params.amountUsd);
      return {
        ok: true,
        dryRun: true,
        order: {
          simulated: true,
          ...params,
          filledAt: new Date().toISOString(),
        },
      };
    }

    if (!this.wallet) {
      return { ok: false, dryRun: false, error: "No wallet configured" };
    }

    try {
      // Resolve token ID: YES = positionIds[0], NO = positionIds[1]
      const market = await this.getMarket(params.conditionId);
      const tokenId =
        params.outcome === "yes"
          ? market.positionIds[0]
          : market.positionIds[1];

      const nonce = String(Date.now());
      const expiry = String(Math.floor(Date.now() / 1000) + 3600);
      const amountWei = ethers.parseUnits(
        String(params.amountUsd),
        6,
      ).toString();
      const priceWei = params.price
        ? ethers.parseUnits(String(params.price), 18).toString()
        : ethers.parseUnits("1", 18).toString();

      const signed = await signOrder(this.wallet, {
        tokenId,
        amount: amountWei,
        price: priceWei,
        side: params.side === "buy" ? 0 : 1,
        nonce,
        expiry,
      });

      const result = await this.post("/v1/orders", signed);
      exposureTracker.recordTrade(params.amountUsd);
      return { ok: true, dryRun: false, order: result };
    } catch (err) {
      return {
        ok: false,
        dryRun: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async cancelOrder(
    orderId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this._dryRun) {
      console.info("[limitless] DRY RUN cancel:", orderId);
      return { ok: true };
    }
    try {
      await this.post("/v1/orders/cancel", { orderId });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async redeemWinnings(
    conditionId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this._dryRun) {
      console.info("[limitless] DRY RUN redeem:", conditionId);
      return { ok: true };
    }
    try {
      await this.post("/v1/redeem", { conditionId });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export const limitlessClient = new LimitlessClient();
