# Architecture

TrustTrail has four parts: two Anchor programs on Solana, a TypeScript backend and a React app. Everything that decides a score or a price runs on-chain. The backend builds unsigned transactions and imports outside history; it never holds a user's funds.

```mermaid
flowchart TB
    subgraph Browser
        A[React app<br/>Vercel]
        W[Wallet<br/>Phantom / Solflare]
        NW[Northwind page<br/>/partner]
    end
    subgraph Backend[Backend · Render]
        API[Express API]
        DB[(Postgres<br/>imports, faucet)]
    end
    subgraph Solana[Solana devnet]
        POOL[Pool program<br/>Eg1s6qF3…EkWL]
        TT[TrustTrail program<br/>BtgvVKaX…JA9s]
        SAS[Solana Attestation Service]
        PYTH[Pyth receiver]
    end
    EXT[Helius · Pyth Hermes<br/>Binance · Birdeye]

    A -- "GET views, POST /…/prepare" --> API
    API -- unsigned transactions --> A
    A -- sign --> W
    W -- send --> POOL
    POOL -- "CPI record_event" --> TT
    TT -- "CPI CreateAttestation" --> SAS
    POOL -- reads price --> PYTH
    API -- "signed set_imported_score" --> TT
    API --> DB
    API --> EXT
    NW -- "one getAccountInfo" --> TT
```

## Components

| Part | Code | Runs on | Job |
| --- | --- | --- | --- |
| TrustTrail program | `programs/trusttrail` | Solana | Owns every wallet's score account, the writer whitelist and the SAS signer. Turns closed loans into a score and a tier. |
| Pool program | `programs/pool` | Solana | Holds lender USDC, issues LP shares, prices and opens loans from the score account, takes repayments, liquidates, accrues interest. |
| Backend | `backend` | Render | Reads chain state into JSON views, builds unsigned transactions, imports lending history from five protocols, runs the tUSDC faucet, serves fresh Pyth updates. |
| App | `app` | Vercel | Score, Import, Borrow, Pool and Record pages, plus Northwind at `/partner`. Signs with the user's wallet. |

## On-chain accounts

```mermaid
flowchart LR
    subgraph TrustTrail
        GC[GlobalConfig<br/>global-config]
        WL[WriterWhitelist<br/>writer_whitelist]
        R[Score account<br/>trust-v2 + wallet]
        SG[SAS signer PDA<br/>sas-signer]
    end
    subgraph Pool
        P[PoolConfig<br/>pool]
        V[USDC vault<br/>vault + pool]
        LP[LP mint<br/>lp + pool]
        CC[CollateralConfig<br/>collateral + mint]
        CV[Collateral vault<br/>coll + pool + mint]
        BS[BorrowerState<br/>borrower + wallet]
        L[Loan<br/>loan + wallet + id]
    end
    AT[SAS attestation<br/>one per loan]

    GC -. authority of .-> WL
    P -. PDA is a writer .-> WL
    L -- "address is the nonce of" --> AT
    SG -- signs --> AT
    P --> V
    P --> LP
    CC --> CV
```

Every account is a PDA, so any app can derive the address from the wallet alone. Full layouts and seeds are in the [Programs Reference](programs-reference.md).

## Flows

### Borrow

```mermaid
sequenceDiagram
    participant U as Wallet
    participant B as Backend
    participant P as Pool program
    participant T as TrustTrail score account
    U->>B: POST /borrow/prepare (amount, collateral)
    B->>B: read tier, limit, latest Pyth update
    B-->>U: unsigned transactions (post price, borrow, close price account)
    U->>P: borrow(amount, collateral_amount)
    P->>P: accrue interest
    P->>T: read score account, recompute tier for now
    P->>P: check limit, liquidity, 90% cap, Pyth price, collateral ratio
    P->>U: USDC out, collateral locked, Loan opened at its tier's index
```

A first borrow also creates the score account (`init_score_v2`) in the same flow.

### Repay

```mermaid
sequenceDiagram
    participant U as Wallet
    participant P as Pool program
    participant T as TrustTrail program
    participant S as SAS
    U->>P: repay()
    P->>P: accrue, debt = scaled debt × tier index
    P->>P: outcome: on time / late / defaulted (by due date and grace)
    P->>U: collateral back after the debt is paid in
    P->>T: CPI record_event (pool PDA signs as writer)
    T->>T: update S⁺ / S⁻, exposure, counters, refresh score and tier
    T->>S: CPI CreateAttestation (nonce = Loan address)
    P->>P: close the Loan (on time raises the next loan limit)
```

The record is written in the same transaction as the repayment. If the attestation fails, the repayment fails too, so a closed loan always has its record.

### Liquidate

Anyone can liquidate a loan whose collateral is worth less than its threshold, or any loan three days past its due date. The liquidator pays the debt (or what the collateral covers), receives collateral at a bonus, and the pool records the loan as liquidated or defaulted through the same `record_event` CPI. Any shortfall comes out of the protocol's fee reserve first. See [Lending Pool](lending-pool.md).

### Import

The wallet signs a message, the backend fetches its history through Helius, rebuilds closed loans, prices them, scores them with the same formula the program uses, and returns a transaction already signed by its writer key. The wallet co-signs and the backend sends it. See [History Import](history-import.md).

### A second lender reads the record

Northwind (`app/src/partner.ts`) derives the score account address, fetches it with one `getAccountInfo` call, checks the owner and decodes the bytes in the browser. No TrustTrail server is involved. See [Lender Integration](lender-integration.md).

## Off-chain services

| Service | Used for |
| --- | --- |
| Helius | Enriched transaction history for the import |
| Pyth Hermes | Signed price updates posted with each borrow; the key stays on the backend |
| Binance, Birdeye | USD price of each imported loan at its peak |
| Postgres | Import records (public through `GET /import-history`), import preview cache and limits, faucet claims |

## Keys

| Key | Holds | Can do |
| --- | --- | --- |
| Admin (GlobalConfig authority) | Developer machine, not the backend | Add or remove writers |
| Pool authority | Developer machine, not the backend | Add collateral types |
| Backend writer key | Render env | `set_imported_score`, co-signed by the wallet |
| Faucet key | Render env | Mint tUSDC (the test token) |
| Pool PDA | No private key | Signs transfers and `record_event` from program code only |

## Deployment

| Part | Where |
| --- | --- |
| TrustTrail program | `BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s` on devnet |
| Pool program | `Eg1s6qF3UhrUYuccyKy9pMBqDQd4beQjYYYZdGs4EkWL` on devnet |
| Backend | `https://trusttrail-devnet-api.onrender.com` |
| App | `https://trusttrail-ten.vercel.app` |
