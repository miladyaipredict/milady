import { ethers } from "ethers";

/** EIP-712 domain — immutable for Limitless CTF Exchange on Base. */
export const LIMITLESS_EIP712_DOMAIN = {
  name: "Limitless CTF Exchange",
  version: "1",
  chainId: 8453,
} as const;

const ORDER_TYPES: Record<string, { name: string; type: string }[]> = {
  Order: [
    { name: "maker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

export interface SignedOrder {
  maker: string;
  tokenId: string;
  amount: string;
  price: string;
  side: number;
  nonce: string;
  expiry: string;
  signature: string;
}

export async function signOrder(
  wallet: ethers.Wallet,
  params: {
    tokenId: string;
    amount: string;
    price: string;
    side: 0 | 1; // 0 = buy, 1 = sell
    nonce: string;
    expiry: string;
  },
): Promise<SignedOrder> {
  const orderData = {
    maker: wallet.address,
    tokenId: params.tokenId,
    amount: params.amount,
    price: params.price,
    side: params.side,
    nonce: params.nonce,
    expiry: params.expiry,
  };

  const signature = await wallet.signTypedData(
    LIMITLESS_EIP712_DOMAIN,
    ORDER_TYPES,
    orderData,
  );

  return {
    ...orderData,
    signature,
  };
}
