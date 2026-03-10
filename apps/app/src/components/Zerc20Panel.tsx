/**
 * zERC20 — Privacy-preserving token panel.
 *
 * Displays zERC20 balances across supported chains and provides
 * wrap / unwrap / private-send actions (wired to backend in Phase 2).
 */

import { useState } from "react";

interface ChainBalance {
  chainId: number;
  label: string;
  symbol: string;
  balance: string;
  usdValue: string;
}

type ActiveView = "overview" | "wrap" | "unwrap" | "send";

const SUPPORTED_CHAINS: { chainId: number; label: string; symbol: string }[] = [
  { chainId: 1, label: "Ethereum", symbol: "zETH" },
  { chainId: 56, label: "BNB Chain", symbol: "zBNB" },
  { chainId: 8453, label: "Base", symbol: "zETH" },
  { chainId: 42161, label: "Arbitrum", symbol: "zETH" },
];

const ZERC20_TOKENS = [
  { symbol: "zETH", name: "zERC20 ETH", chains: [1, 8453, 42161] },
  { symbol: "zBNB", name: "zERC20 BNB", chains: [56, 1, 8453, 42161] },
  { symbol: "zUSDC", name: "zERC20 USDC", chains: [1, 8453, 42161] },
];

function ChainIcon({ chainId }: { chainId: number }) {
  const colors: Record<number, string> = {
    1: "#627EEA",
    56: "#F0B90B",
    8453: "#0052FF",
    42161: "#28A0F0",
  };
  const labels: Record<number, string> = {
    1: "E",
    56: "B",
    8453: "Ba",
    42161: "A",
  };
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold text-white shrink-0"
      style={{ backgroundColor: colors[chainId] ?? "#666" }}
    >
      {labels[chainId] ?? "?"}
    </span>
  );
}

function OverviewView({
  balances,
  onAction,
}: {
  balances: ChainBalance[];
  onAction: (view: ActiveView) => void;
}) {
  const totalUsd = balances.reduce(
    (sum, b) => sum + Number.parseFloat(b.usdValue || "0"),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Total Value */}
      <div className="px-4 py-4 bg-white/[0.03] rounded-lg border border-white/[0.06]">
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">
          Total Private Balance
        </div>
        <div className="text-2xl font-bold text-white/90 font-mono">
          ${totalUsd.toFixed(2)}
        </div>
      </div>

      {/* Token Balances */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-3 px-1">
          Tokens
        </div>
        <div className="flex flex-col gap-2">
          {ZERC20_TOKENS.map((token) => (
            <div
              key={token.symbol}
              className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] rounded-lg border border-white/[0.06] hover:border-white/10 transition-colors"
            >
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#22c55e]/15 text-[#22c55e] text-xs font-bold shrink-0">
                z
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-white/90">
                  {token.symbol}
                </div>
                <div className="text-[11px] text-white/40">{token.name}</div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-mono text-white/80">0.00</div>
                <div className="text-[10px] text-white/35 font-mono">
                  $0.00
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chain Breakdown */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-3 px-1">
          By Chain
        </div>
        <div className="flex flex-col gap-1.5">
          {SUPPORTED_CHAINS.map((chain) => {
            const chainBal = balances.find(
              (b) => b.chainId === chain.chainId,
            );
            return (
              <div
                key={chain.chainId}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                <ChainIcon chainId={chain.chainId} />
                <span className="text-[13px] text-white/70 flex-1">
                  {chain.label}
                </span>
                <span className="text-[12px] font-mono text-white/50">
                  {chainBal?.balance ?? "0.00"} {chain.symbol}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-1">
        <button
          type="button"
          onClick={() => onAction("wrap")}
          className="flex-1 px-4 py-2.5 rounded-lg bg-[#22c55e]/15 border border-[#22c55e]/30 text-[#22c55e] text-[13px] font-semibold cursor-pointer hover:bg-[#22c55e]/25 transition-colors"
        >
          Wrap
        </button>
        <button
          type="button"
          onClick={() => onAction("unwrap")}
          className="flex-1 px-4 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/70 text-[13px] font-semibold cursor-pointer hover:bg-white/[0.08] transition-colors"
        >
          Unwrap
        </button>
        <button
          type="button"
          onClick={() => onAction("send")}
          className="flex-1 px-4 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/70 text-[13px] font-semibold cursor-pointer hover:bg-white/[0.08] transition-colors"
        >
          Private Send
        </button>
      </div>

      {/* Info */}
      <div className="px-4 py-3 bg-[#22c55e]/[0.06] rounded-lg border border-[#22c55e]/15 text-[11px] text-[#22c55e]/70 leading-relaxed">
        zERC20 enables private ERC-20 transfers using zero-knowledge proofs
        (EIP-7503). Wrap tokens to get privacy, unwrap to exit. Cross-chain
        teleport supported via LayerZero.
      </div>
    </div>
  );
}

function ActionView({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/60 hover:text-white hover:border-white/20 cursor-pointer transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="text-[14px] font-semibold text-white/90">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function WrapView({ onBack }: { onBack: () => void }) {
  return (
    <ActionView title="Wrap ERC-20 → zERC20" onBack={onBack}>
      <div className="flex flex-col gap-3 px-1">
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Token
          </label>
          <select className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] outline-none focus:border-[#22c55e]/40">
            <option value="eth">ETH</option>
            <option value="bnb">BNB</option>
            <option value="usdc">USDC</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Amount
          </label>
          <input
            type="text"
            placeholder="0.0"
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] font-mono outline-none focus:border-[#22c55e]/40 placeholder:text-white/20"
          />
        </div>
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Chain
          </label>
          <select className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] outline-none focus:border-[#22c55e]/40">
            <option value="1">Ethereum</option>
            <option value="56">BNB Chain</option>
            <option value="8453">Base</option>
            <option value="42161">Arbitrum</option>
          </select>
        </div>
        <button
          type="button"
          className="mt-2 w-full px-4 py-3 rounded-lg bg-[#22c55e] text-black text-[13px] font-bold cursor-pointer hover:bg-[#22c55e]/90 transition-colors"
        >
          Wrap
        </button>
        <div className="text-[11px] text-white/30 text-center">
          Plugin not yet connected — coming soon
        </div>
      </div>
    </ActionView>
  );
}

function UnwrapView({ onBack }: { onBack: () => void }) {
  return (
    <ActionView title="Unwrap zERC20 → ERC-20" onBack={onBack}>
      <div className="flex flex-col gap-3 px-1">
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Token
          </label>
          <select className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] outline-none focus:border-[#22c55e]/40">
            <option value="zeth">zETH</option>
            <option value="zbnb">zBNB</option>
            <option value="zusdc">zUSDC</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Amount
          </label>
          <input
            type="text"
            placeholder="0.0"
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] font-mono outline-none focus:border-[#22c55e]/40 placeholder:text-white/20"
          />
        </div>
        <button
          type="button"
          className="mt-2 w-full px-4 py-3 rounded-lg bg-white/10 text-white/80 text-[13px] font-bold cursor-pointer hover:bg-white/15 transition-colors"
        >
          Unwrap
        </button>
        <div className="text-[11px] text-white/30 text-center">
          Plugin not yet connected — coming soon
        </div>
      </div>
    </ActionView>
  );
}

function PrivateSendView({ onBack }: { onBack: () => void }) {
  return (
    <ActionView title="Private Send" onBack={onBack}>
      <div className="flex flex-col gap-3 px-1">
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Recipient
          </label>
          <input
            type="text"
            placeholder="0x..."
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] font-mono outline-none focus:border-[#22c55e]/40 placeholder:text-white/20"
          />
        </div>
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Token
          </label>
          <select className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] outline-none focus:border-[#22c55e]/40">
            <option value="zeth">zETH</option>
            <option value="zbnb">zBNB</option>
            <option value="zusdc">zUSDC</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Amount
          </label>
          <input
            type="text"
            placeholder="0.0"
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] font-mono outline-none focus:border-[#22c55e]/40 placeholder:text-white/20"
          />
        </div>
        <div>
          <label className="text-[11px] text-white/40 uppercase tracking-wider mb-1.5 block">
            Destination Chain
          </label>
          <select className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/80 text-[13px] outline-none focus:border-[#22c55e]/40">
            <option value="1">Ethereum</option>
            <option value="56">BNB Chain</option>
            <option value="8453">Base</option>
            <option value="42161">Arbitrum</option>
          </select>
        </div>
        <button
          type="button"
          className="mt-2 w-full px-4 py-3 rounded-lg bg-[#22c55e] text-black text-[13px] font-bold cursor-pointer hover:bg-[#22c55e]/90 transition-colors"
        >
          Send Privately
        </button>
        <div className="text-[11px] text-white/30 text-center">
          Plugin not yet connected — coming soon
        </div>
      </div>
    </ActionView>
  );
}

export function Zerc20Panel() {
  const [activeView, setActiveView] = useState<ActiveView>("overview");
  const [balances] = useState<ChainBalance[]>(() =>
    SUPPORTED_CHAINS.map((c) => ({
      ...c,
      balance: "0.00",
      usdValue: "0",
    })),
  );

  if (activeView === "wrap") {
    return (
      <div className="p-4">
        <WrapView onBack={() => setActiveView("overview")} />
      </div>
    );
  }
  if (activeView === "unwrap") {
    return (
      <div className="p-4">
        <UnwrapView onBack={() => setActiveView("overview")} />
      </div>
    );
  }
  if (activeView === "send") {
    return (
      <div className="p-4">
        <PrivateSendView onBack={() => setActiveView("overview")} />
      </div>
    );
  }

  return (
    <div className="p-4">
      <OverviewView balances={balances} onAction={setActiveView} />
    </div>
  );
}
