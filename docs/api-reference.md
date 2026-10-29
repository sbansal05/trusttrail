# API Reference

Base URL: `https://trusttrail-devnet-api.onrender.com`

The backend reads Solana state and builds **unsigned** transactions; the wallet signs and sends them. It never holds user funds or user keys.

- All amounts are **decimal strings of base units**: tUSDC has 6 decimals (`"200000000"` = 200 tUSDC), SOL is in lamports.
- Rates and ratios are integers in bps (`600` = 6.00%, `15000` = 150%).
- Times are Unix seconds from the Solana cluster clock.
- Response values below are examples; field names and types are exact.
- `transactions` are base64 serialized transactions; sign and send them **in order**.
- Errors are `{ "error": "message", ...details }` with a 4xx status for a refused request and 5xx for a failure.
- The backend runs on a free Render instance: after 15 minutes idle the first request can take about a minute.

| Method | Path | What it returns |
| --- | --- | --- |
| GET | [`/score/:wallet`](#get-scorewallet) | Live score, tier, factors, import coverage, repayment attestations |
| POST | [`/import/prepare`](#post-importprepare) | Import transaction for the wallet to co-sign |
| POST | [`/import/submit`](#post-importsubmit) | Sends the co-signed import |
| GET | [`/import-history/:wallet`](#get-import-historywallet) | Every loan an import counted, with its price |
| GET | [`/import-preview/:wallet`](#get-import-previewwallet) | What an import would give, read only (cached, rate limited) |
| GET | [`/pool`](#get-pool) | Rates per tier, utilization, lender APY, reserve, collaterals |
| GET | [`/loans/:wallet`](#get-loanswallet) | The wallet's offer, balances and open loans with health |
| POST | [`/borrow/prepare`](#post-borrowprepare) | Borrow transactions |
| POST | [`/repay/prepare`](#post-repayprepare) | Repay transaction |
| GET | [`/pool/loans`](#get-poolloans) | Every pool loan, counted by tier and outcome |
| GET | [`/lender/:wallet`](#get-lenderwallet) | Pool shares, their value, what can be withdrawn now |
| POST | [`/deposit/prepare`](#post-depositprepare) | Deposit transaction |
| POST | [`/withdraw/prepare`](#post-withdrawprepare) | Withdraw transaction |
| GET | [`/price-update/:feed`](#get-price-updatefeed) | Latest signed Pyth update |
| POST | [`/faucet`](#post-faucet) | 1,000 test tUSDC, once per 24 hours |

---

## Score

### GET /score/:wallet

```bash
curl https://trusttrail-devnet-api.onrender.com/score/Bc8CaB5EKstRyp4NnoMGaQ5ANVnF782Yh7PaeuJWAb8Q
```

```json
{
  "wallet": "Bc8C…Ab8Q",
  "exists": true,
  "asOf": 1791820800,
  "score": 1,
  "tier": 1,
  "tierName": "bronze",
  "lastUpdate": 1791820740,
  "factors": {
    "native": 43,
    "imported": 0,
    "importDate": 0,
    "blend": { "exposureBps": "3463", "fullWeightBps": "80000", "nativeShareBps": "432", "importedShareBps": "9568" },
    "meaningful": { "onTime": 1, "weightBps": "3463" },
    "liquidation": { "last": 0, "blockedUntil": null },
    "nextTier": {
      "tier": "silver",
      "gates": [
        { "gate": "score", "have": "1", "need": "500", "met": false },
        { "gate": "meaningfulOnTime", "have": "1", "need": "3", "met": false },
        { "gate": "meaningfulWeightBps", "have": "3463", "need": "30000", "met": false }
      ]
    }
  },
  "coverage": { "importId": null, "importedAt": null, "nextImportAt": null, "protocols": [] },
  "attestations": [
    {
      "address": "…",
      "loan": "…",
      "borrower": "Bc8C…Ab8Q",
      "lenderProgram": "…",
      "principalUsdc": "200000000",
      "interestPaidUsdc": "33000",
      "openedAt": 1791734000,
      "dueAt": 1794326000,
      "closedAt": 1791820740,
      "outcome": 0,
      "collateralRatioBps": 15000,
      "tierAtOpen": 0
    }
  ]
}
```

`exists: false` means the wallet has no score account yet; every field then reads as zero. The score and tier are recomputed for `asOf`, so they can differ from the cached values in the account. `nextTier` is `null` at Gold.

---

## Import

See [History Import](history-import.md) for what the import does.

### POST /import/prepare

The wallet first signs the message `TrustTrail import for <wallet> at <unix seconds>` (valid for 7 minutes), so the backend only spends API credits on a wallet's real owner.

```json
{ "wallet": "Bc8C…Ab8Q", "timestamp": 1791820800, "signature": "<base58 signature of the message>" }
```

```json
{
  "importId": "42",
  "transaction": "<base64, signed by the backend writer, needs the wallet's signature>",
  "score": 612,
  "meaningfulOnTime": 5,
  "newLoans": 7,
  "pricedLoans": 7,
  "unpricedLoans": 1,
  "sameTransactionLoans": 3,
  "createsAccount": false
}
```

| Status | Error |
| --- | --- |
| 401 | `invalid or expired signed message` |
| 429 | `import cooldown has not passed`, with `nextImportAt` |

### POST /import/submit

```json
{ "importId": "42", "transaction": "<the same transaction, now also signed by the wallet>" }
```

```json
{ "signature": "<transaction signature>" }
```

The backend refuses a transaction whose message differs from the one it prepared (`400 transaction differs from the prepared one`).

### GET /import-history/:wallet

The latest confirmed import; `?all=true` returns every import, newest first. Each import lists `score`, `meaningfulOnTime`, `meaningfulWeightBps`, `previousImportDate`, `computedAt`, `newLoans`, `checkedProtocols`, the confirming `txSignature`, and every loan with its protocol, position, mint, amount, USD value, price, price source and price gap. `404` if the wallet never imported.

### GET /import-preview/:wallet

What an import would give the wallet, with nothing signed or written. The history is read, priced and scored like an import, over the whole history (as a first import would be). There is no tier: a tier also needs the native part.

```bash
curl https://trusttrail-devnet-api.onrender.com/import-preview/Bc8CaB5EKstRyp4NnoMGaQ5ANVnF782Yh7PaeuJWAb8Q
```

```json
{
  "wallet": "Bc8C…Ab8Q",
  "computedAt": 1791820800,
  "cached": false,
  "checkedProtocols": ["kamino", "marginfi", "save", "jupiter_lend", "loopscale"],
  "score": 412,
  "meaningfulOnTime": 3,
  "meaningfulWeightBps": "31250",
  "counts": { "loans": 9, "priced": 8, "unpriced": 1, "unpricedLiquidations": 0, "sameTransaction": 2 },
  "historyCapped": false,
  "loans": ["…same shape as the loans in /import-history…"]
}
```

- `computedAt` is the backend's clock when the history was read. A cached answer keeps it and has `cached: true`.
- Each wallet's result is reused for `IMPORT_PREVIEW_CACHE_HOURS` (default 6). Cached answers are free and never limited.
- Fresh reads are limited per IP (`IMPORT_PREVIEW_PER_IP_PER_HOUR`, default 5 an hour) and overall (`IMPORT_PREVIEW_PER_DAY`, default 50 in 24 hours). Reads still running and failed reads count, since they spend Helius credits too. Over a limit: `429` with `retryAt`. Requests arriving at the same moment can pass a limit by one or two.
- `historyCapped` is `true` when the page limit (20 pages of 100 transactions per address) cut the wallet's or a position's history short, so older loans may be missing.
- `unpricedLiquidations` counts liquidated or defaulted loans without a price: they are listed but not scored.
- `400` for an invalid address (not counted toward the limits), `502` when the history could not be read.

---

## Pool

### GET /pool

```json
{
  "pool": "<PoolConfig address>",
  "asOf": 1791820800,
  "idleUsdc": "10000000000",
  "totalBorrowedUsdc": "1000000000",
  "totalAssetsUsdc": "10999000000",
  "badDebtUsdc": "0",
  "utilizationBps": 909,
  "lenderApyBps": 51,
  "reserveFactorBps": 1000,
  "reserveUsdc": "1000000",
  "borrowCapBps": 9000,
  "borrowRoomUsdc": "8900000000",
  "tiers": [
    { "tier": 0, "name": "unproven", "aprBps": 633, "maxLoanUsdc": "200000000", "collateralBps": 15000 },
    { "tier": 1, "name": "bronze", "aprBps": 433, "maxLoanUsdc": "250000000", "collateralBps": 14000 },
    { "tier": 2, "name": "silver", "aprBps": 233, "maxLoanUsdc": "1000000000", "collateralBps": 13000 },
    { "tier": 3, "name": "gold", "aprBps": 83, "maxLoanUsdc": "5000000000", "collateralBps": 12000 }
  ],
  "collaterals": [
    { "symbol": "SOL", "mint": "So111…1112", "decimals": 9, "minTier": 0, "liqThresholdBps": 11000, "liqBonusBps": 500, "maxAgeSecs": 60, "price": 115.52, "priceAt": 1791820790 },
    { "symbol": "tUSDC", "mint": "…", "decimals": 6, "minTier": 0, "liqThresholdBps": 10500, "liqBonusBps": 200, "maxAgeSecs": 60, "price": 1, "priceAt": 1791820790 }
  ]
}
```

`borrowRoomUsdc` is how much more can be lent before the 90% cap. `price` is for display; the program values collateral at Pyth's low price.

### GET /loans/:wallet

```json
{
  "wallet": "Bc8C…Ab8Q",
  "asOf": 1791820800,
  "balances": { "solLamports": "9983000000", "tusdc": "1899960000" },
  "offer": {
    "tier": 0, "tierName": "unproven", "hasScoreAccount": true,
    "maxLoanUsdc": "200000000", "tierMaxLoanUsdc": "200000000", "largestRepaidUsdc": "100000000",
    "collateralBps": 15000, "aprBps": 600, "collateralBufferBps": 500,
    "collaterals": [ "…same shape as in /pool…" ]
  },
  "loans": [
    {
      "address": "<Loan>", "loanId": "1", "tierAtOpen": 0,
      "principalUsdc": "200000000", "debtUsdc": "200016000", "aprBps": 600,
      "collateral": { "symbol": "tUSDC", "mint": "…", "amount": "315034040", "decimals": 6, "valueUsdc": "315000000", "price": 1 },
      "collateralRatioBps": 15000, "healthBps": 15748, "liqThresholdBps": 10500, "liquidationPrice": 0.6666,
      "openedAt": 1791734000, "dueAt": 1794326000, "graceEndsAt": 1794585200, "state": "active"
    }
  ]
}
```

`offer.maxLoanUsdc` is the lower of the wallet's limit and the room left under the 90% cap. `healthBps` is collateral value ÷ debt. `state` is `active`, `late` (in the grace period) or `defaulted`.

### POST /borrow/prepare

```json
{ "wallet": "Bc8C…Ab8Q", "collateral": "SOL", "amount": "200000000" }
```

`collateralAmount` is optional; without it the backend uses the tier minimum plus a 5% buffer, sized from the same Pyth update the transaction will post.

```json
{
  "loan": "<the Loan address this borrow will create>",
  "amountUsdc": "200000000",
  "collateral": "SOL",
  "collateralAmount": "2726850000",
  "minCollateral": "2597000000",
  "price": 115.52,
  "transactions": ["<base64>", "<base64>", "…"]
}
```

`transactions` come in send order: post the Pyth update (it can take more than one transaction), the borrow, then close the price account so the rent comes back. They are already signed by the throwaway keys the Pyth receiver uses; only the wallet's signature is missing. The first borrow also creates the score account and the token accounts it needs. SOL is wrapped automatically.

| Status | Error |
| --- | --- |
| 400 | `amount is above this wallet's limit`, with `maxLoanUsdc` |
| 400 | `the pool does not have that much to lend`, with `idleUsdc` |
| 400 | `the pool keeps 10% free for withdrawals; this loan would go past that`, with `roomUsdc` |
| 400 | `not enough collateral for this tier`, with `minCollateral` |
| 400 | `not enough SOL for this collateral and the fees` / `not enough tUSDC for this collateral` |

### POST /repay/prepare

```json
{ "wallet": "Bc8C…Ab8Q", "loan": "<Loan address>" }
```

```json
{ "loan": "<Loan address>", "debtUsdc": "200033000", "transactions": ["<repay>"] }
```

The transaction repays the full debt, records the outcome on-chain and returns the collateral to the wallet (SOL is unwrapped). `404 loan not found`, `403 this loan belongs to another wallet`, `400 this loan is already closed`, `400 not enough tUSDC to repay`.

### GET /pool/loans

Every loan the pool has made: `open` (each with its borrower and the same fields as `/loans`) and `byTier`, one row per tier with `loans`, `lentUsdc`, `open`, `repaid`, `liquidated` and `defaulted`.

### GET /lender/:wallet

```json
{
  "wallet": "…", "asOf": 1791820800,
  "tusdc": "500000000", "shares": "1000000000", "valueUsdc": "1004200000",
  "shareOfPoolBps": 909, "withdrawableUsdc": "1004200000"
}
```

`withdrawableUsdc` is capped by idle USDC; lent-out money comes back as loans are repaid.

### POST /deposit/prepare

```json
{ "wallet": "…", "amount": "1000000000" }
```

```json
{ "amountUsdc": "1000000000", "shares": "995800000", "transactions": ["<deposit>"] }
```

### POST /withdraw/prepare

Either an amount of tUSDC or everything:

```json
{ "wallet": "…", "amount": "500000000" }
```

```json
{ "wallet": "…", "all": true }
```

```json
{ "shares": "497909000", "amountUsdc": "500000000", "transactions": ["<withdraw>"] }
```

---

## Prices and faucet

### GET /price-update/:feed

`feed` is `SOL_USD` or `USDC_USD`. Returns `{ "feed", "data", "price" }`, where `data` is a signed Pyth Hermes update the app posts with a borrow or a liquidation. One Hermes answer per feed is shared for a couple of seconds.

### POST /faucet

```json
{ "wallet": "…" }
```

```json
{ "signature": "…", "amount": "1000000000", "nextClaimAt": 1791907200 }
```

`429 already claimed in the last 24 hours`, with `nextClaimAt`. tUSDC is TrustTrail's own devnet test token, not real USDC.