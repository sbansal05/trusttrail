import { clusterApiUrl } from "@solana/web3.js";


export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
export const RPC_URL = import.meta.env.VITE_RPC_URL || clusterApiUrl("devnet");

export const explorerAddress = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`;
export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;