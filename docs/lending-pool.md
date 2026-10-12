# Lending Pool

The pool program (`programs/pool`) is a single USDC pool. Lenders deposit and get LP shares; borrowers post collateral and borrow at a price set by their TrustTrail tier. Every loan is fully collateralized: the score changes how much collateral and what rate, never whether collateral is needed.

## Loan terms by tier

| Tier | Collateral | Spread over base rate | APR at the 2% floor | Tier max loan |
| --- | --- | --- | --- | --- |
| Unproven | 150% | +4.0% | 6.0% | 200 USDC |
| Bronze | 140% | +2.0% | 4.0% | 250 USDC |
| Silver | 130% | 0 | 2.0% | 1,000 USDC |
| Gold | 120% | −1.5% | 0.5% | 5,000 USDC |

### Loan limit

```
max_loan = min( TIER_MAX_LOAN[tier] , max( 2 × largest_repaid , 200 USDC ) )
```

`largest_repaid` is the biggest loan this wallet has repaid **on time** in this pool. A Gold wallet that has never borrowed here still starts at 200 USDC and can double each time. The 200 USDC floor exists because a $100 loan carries no score weight; a first loan has to be able to count.

### Term

Every loan is due 30 days after it opens. Repaying by the due date is on time; inside the next 3 days it is late; after that the loan is in default and anyone can liquidate it. A borrower can still repay a defaulted loan until someone liquidates it, and it is recorded as defaulted.

## Interest

### Base rate

The base APR follows utilization `U = borrowed ÷ (borrowed + idle)`, two straight lines meeting at a 95% kink. It is calibrated on Kamino's Main Market USDC reserve (6 Oct 2026), rounded, with a 2% floor.

| Utilization | Base APR | Unproven | Bronze | Silver | Gold |
| --- | --- | --- | --- | --- | --- |
| 0% | 2.00% | 6.00% | 4.00% | 2.00% | 0.50% |
| 50% | 3.84% | 7.84% | 5.84% | 3.84% | 2.34% |
| 90% | 5.31% | 9.31% | 7.31% | 5.31% | 3.81% |
| 95% (kink) | 5.50% | 9.50% | 7.50% | 5.50% | 4.00% |
| 100% | 36.00% | 40.00% | 38.00% | 36.00% | 34.50% |

### Per-tier borrow index

The pool keeps one borrow index per tier, starting at 1.0 (WAD, 18 decimals). On every instruction it first accrues:

```
index_t ← index_t × (1 + rate_t × Δt ÷ year)
```

A loan stores `scaled_debt = principal ÷ index_at_open` (rounded up) and its `tier_at_open`. What it owes at any moment is `scaled_debt × index_now` (rounded up). A loan keeps the tier it opened with until it closes, even if the wallet moves to another tier meanwhile. Rounding always favours the pool.

### Reserve

10% of all borrower interest goes to the protocol (`protocol_fees`). It stays in the vault and is the first-loss reserve: bad debt is taken from it before it reaches lenders.

## Lenders

| | Rule |
| --- | --- |
| Pool value | `total_assets = idle USDC + total borrowed − protocol fees` |
| Deposit | First deposit is 1 share per USDC; after that `shares = amount × supply ÷ total_assets`, rounded down |
| Withdraw | `amount = shares × total_assets ÷ supply`, rounded down, paid only from idle USDC |
| Lender APY | Interest borrowers pay per year × 90% ÷ total_assets |

### 90% borrow cap

A new loan is refused if it would take utilization past 90%. At least a tenth of the pool stays idle, so lenders can always withdraw something, and the rate stays below the steep part of the curve for new loans.

## Collateral

| Asset | Pyth feed | Max price age | Liquidated below | Liquidator bonus | Min tier |
| --- | --- | --- | --- | --- | --- |
| SOL | SOL/USD | 60 s | 110% | 5% | any |
| tUSDC | USDC/USD | 60 s | 105% | 2% | any |

Collateral is valued at **price − confidence**, the low end of Pyth's range, and only fully verified Pyth updates are accepted. The backend posts a fresh update in the same flow as each borrow and closes the price account afterwards, so the rent comes back.

The admin adds collateral with `add_collateral`. The program refuses a threshold that leaves no room for the bonus above 100%, or one at or above the lowest tier ratio (120%), so no loan can be liquidatable the moment it opens.

## Liquidation

A loan can be liquidated by anyone when:

- its collateral is worth less than the asset's threshold × debt, or
- it is in default (more than 3 days past due).

| Collateral value | Liquidator pays | Liquidator gets | Borrower gets back | Bad debt |
| --- | --- | --- | --- | --- |
| ≥ debt × (1 + bonus) | the whole debt | collateral worth debt × (1 + bonus) | the rest | 0 |
| between debt and debt × (1 + bonus) | the whole debt | all collateral | nothing | 0 |
| < debt | value ÷ (1 + bonus) | all collateral | nothing | debt − paid |

Bad debt is taken from the protocol fee reserve first; only what the reserve cannot cover is counted as `bad_debt`, the lenders' loss.

**Example.** A 200 USDC loan against SOL is liquidatable once the SOL is worth less than $220. If it is worth $230, the liquidator pays 200 USDC and receives $210 of SOL; the remaining $20 of SOL goes back to the borrower.

Every liquidation is written to the borrower's record in the same transaction: **defaulted** (3 × w penalty) if past the grace period, **liquidated** (2 × w) otherwise. Both block Silver and Gold for 90 days.

## Checks at borrow, in order

1. The wallet's tier (recomputed for this second) may post this collateral.
2. `amount ≤ max_loan`.
3. `amount ≤ idle USDC`.
4. The loan keeps utilization at or under 90%.
5. The Pyth update is a verified PriceUpdateV2 for this asset's feed, at most 60 s old.
6. Collateral value ≥ amount × the tier's collateral ratio.

The error each check returns is listed in the [Programs Reference](programs-reference.md#pool-errors).
