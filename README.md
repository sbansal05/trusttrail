# TrustTrail

**A portable, on-chain credit score for Solana lending — built from real wallet behavior, not self-reported claims.**

Every major Solana lending protocol treats a wallet as an anonymous stranger with zero history, forcing heavy over-collateralization regardless of how long that wallet has been responsibly using DeFi. TrustTrail fixes the input problem: it turns a wallet's actual on-chain financial behavior — general activity patterns plus real lending history from Kamino — into a single, verifiable score that any protocol can read trustlessly.

---

## How it works

A user connects their wallet, previews a live-computed score, and — with one signed message proving they control that wallet — records it permanently as an on-chain account any program can query.

```
Wallet connects → Backend computes score from real on-chain data
                → User signs a message proving ownership
                → Backend verifies signature, writes score on-chain
                → Any Solana program can now read this wallet's score
```

## The score

Six factors, weighted toward what actually predicts creditworthiness rather than treating every signal equally:

| Factor | Weight | What it measures |
|---|---|---|
| **Repayment** | 35% | Of every loan taken out on Kamino, how many were repaid |
| **Liquidation** | 20% | Liquidation events, penalized on an escalating curve |
| **Wealth** | 15% | Log-scaled portfolio value |
| **History** | 10% | Wallet age |
| **Activity** | 10% | Consistency of on-chain activity, month over month |
| **Diversity** | 10% | Breadth of distinct programs the wallet has interacted with |

Every wallet is scored 0–1000 and lands in a tier — **Bronze** (0–499), **Silver** (500–749), **Gold** (750–1000) — matching the trust level most dApps would reasonably gate around.

A wallet that's never taken out a loan isn't scored as if it defaulted — it's scored as a neutral, unproven "thin file," distinct from both a strong repayment history and a genuinely bad one.

## Architecture

- **On-chain** — an Anchor program on Solana devnet stores each wallet's score, a claims bitmask, and flags as a PDA, readable by any program in a single account fetch.
- **Backend** — TypeScript/Express. Pulls general wallet history via Helius, decodes real Kamino Lending transactions directly from raw instruction data to compute repayment and liquidation behavior, and signs the resulting on-chain write with a dedicated authority keypair.
- **Frontend** — React/Vite with `@solana/wallet-adapter`. A live preview computes a score on demand; recording it on-chain requires the connected wallet to sign a challenge message, verified server-side before any computation runs.

## Notable engineering decisions

- **Kamino's instruction discriminators are computed, not read.** Its IDL predates Anchor's newer format and doesn't embed them directly — they're derived via `sha256("global:" + snake_case_name)`, using the original Rust function name, not the camelCase name the IDL displays for JS/TS convenience.
- **Signature verification runs before any computation, not after.** An unsigned or forged request is rejected immediately, rather than after burning a full scoring computation against Helius.
- **A single liquidation costs little; a pattern costs a lot.** The liquidation penalty escalates rather than applying a flat cost per event — one liquidation can plausibly be a single bad-luck market event, while several in a row is a real signal about risk management.
- **Every sub-score handles the empty-wallet case explicitly** — a brand-new wallet returns a real, valid low score rather than throwing, treating "no data yet" and "bad data" as genuinely different situations throughout.

## Running locally

```bash
# On-chain program
anchor build && anchor deploy --provider.cluster devnet

# Backend
cd backend
npm install
# .env needs: HELIUS_API, AUTHORITY_PRIVATE_KEY (see .env.example)
npx tsx src/server.ts

# Frontend
cd app
npm install
npm run dev
```

## Stack

Anchor · Rust · TypeScript · Express · React · Vite · Helius API · `@kamino-finance/klend-sdk` · `@solana/wallet-adapter`