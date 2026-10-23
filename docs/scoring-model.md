# Scoring Model

Every wallet has one score from 0 to 1000 and one of four tiers. The score is computed by the TrustTrail program (`programs/trusttrail/src/scoring.rs`) every time a loan closes or history is imported. The backend uses a line-for-line TypeScript copy (`backend/src/history/scoring.ts`, integers only, no floats) to score imports and to show live factors.

The rules come from a Dune analysis of Solana lending done before scoring v2 was written. Each rule below says whether it was **measured** in that analysis or is a **policy** choice.

## 1. What one loan is worth

Each closed loan adds to one of two running totals:

- **S⁺**, good history: on-time and late repayments.
- **S⁻**, penalties: liquidations and defaults.

### Principal weight w(P)

Weight grows with the log of the principal, so one big loan cannot outweigh a steady record. The program interpolates linearly between these rows (within 0.016 of the exact curve):

| Principal | Weight |
| --- | --- |
| ≤ $100 | 0 |
| $150 | 0.2026 |
| $200 | 0.3463 |
| $300 | 0.5489 |
| $500 | 0.8041 |
| $740 (median loan) | 1.0000 |
| $2,500 | 1.0244 |
| $10,000 | 1.0522 |
| $50,000 | 1.0845 |
| ≥ $108,000 | 1.1000 (cap) |

Loans of $100 or less carry no weight (measured). This is what stops a wallet from farming a score with many tiny loans.

### Duration D

`D = min(1, hours open ÷ 24)`. A loan counts in full only after 24 hours; one repaid after 12 hours counts half (policy, a bot filter).

### Outcome O

| Outcome | Code | Effect |
| --- | --- | --- |
| On time | 0 | S⁺ += w · D · 1.0 · F |
| Late (inside the grace period) | 1 | S⁺ += w · D · 0.5 · F |
| Liquidated | 2 | S⁻ += 2 · w |
| Defaulted (after the grace period) | 3 | S⁻ += 3 · w |

### Due-date factor F

A loan with a due date counts 1.0; one without (floating-rate DeFi positions) counts 0.5. A due date proves on-time discipline; a floating position mostly shows position management. Penalties are not halved. Every TrustTrail pool loan has a due date.

## 2. Penalties fade

S⁻ halves every 90 days (policy, matching the 90-day tier block). The program stores S⁻ with the time it was last decayed and decays it again before every change, so a liquidation two years ago weighs almost nothing today.

## 3. Native score

```
native = clamp( 1000 × ( min(S⁺, 8.0) − S⁻_now ) ÷ 8.0 , 0 , 1000 )
```

S⁺ is capped at 8.0 (eight median loans) before penalties are subtracted, so a long history cannot absorb a liquidation: each one costs about 250 × w points.

## 4. Blending with imported history

A wallet can import its history from other protocols ([History Import](history-import.md)). The program blends it with the native score:

```
α     = min(1, E ÷ 8.0)
score = α · native + (1 − α) · imported
```

**E** (exposure) is the sum of w over the wallet's meaningful native loans (repaid in full, at least $100, open at least 24 hours) plus every liquidated or defaulted one. A wallet with a bad TrustTrail record cannot hide it behind good imported history: every bad outcome raises E, so the native part decides more. A loan repaid within minutes adds nothing to E, so quick loans cannot raise α. E recorded under the earlier rule, which counted every closed loan, was recomputed from each wallet's attestations.

## 5. Tiers

All gates of a tier must pass; the highest tier that passes wins.

| Tier | Score | Meaningful on-time loans | Σ w of those loans | Liquidation in last 90 days |
| --- | --- | --- | --- | --- |
| Unproven | 0 | | | |
| Bronze | > 0 | | | |
| Silver | ≥ 500 | ≥ 3 | ≥ 3.0 | none |
| Gold | ≥ 750 | ≥ 8 | ≥ 8.0 | none |

A **meaningful** loan was repaid in full, had a principal of at least $100 and stayed open at least 24 hours. A liquidation or default blocks Silver and Gold for 90 days, however high the score.

The stored tier is a cache from the last update. The pool recomputes it at every borrow with penalties decayed to that second (`UserReputationV2::standing(now)`), so a block ending or a penalty fading takes effect without any transaction.

## Worked examples

**A first $200 loan, repaid on time after 24 hours.** w = 0.3463, D = 1, F = 1, so S⁺ = 0.3463. Native = 1000 × 0.3463 ÷ 8 = 43. With no import, α = 0.3463 ÷ 8 = 4.3%, so score = 43 × 0.043 = **1**. Score above 0: **Bronze**.

**Four $740 loans, all on time.** S⁺ = 4.0, native = 500, E = 4.0, α = 50%. Without an import the score is 250 (Bronze); with an imported score of 750 it is 0.5 × 500 + 0.5 × 750 = 625. Four meaningful loans with Σw = 4.0 pass the Silver gates, so the second wallet is **Silver**.

**Gold wallet liquidated on a $740 loan.** S⁻ += 2.0, so native drops by 250 points, and Silver and Gold are blocked for 90 days: the wallet borrows as **Bronze** until the block ends.

## Where the numbers live

| Constant | Value | File |
| --- | --- | --- |
| `WEIGHT_TABLE` | rows above | `programs/trusttrail/src/constants.rs` |
| `MIN_PRINCIPAL_USDC` | 100 USDC | same |
| `MIN_HOLD_SECS` | 86,400 | same |
| `FULL_WEIGHT_BPS` | 80,000 (8.0) | same |
| `PENALTY_HALF_LIFE_SECS` | 90 days | same |
| `O_LATE_BPS` / `O_LIQUIDATED_BPS` / `O_DEFAULTED_BPS` | 0.5 / 2.0 / 3.0 | same |
| `NO_DUE_DATE_FACTOR_BPS` | 0.5 | same |
| `SILVER_MIN_*`, `GOLD_MIN_*` | gates above | same |
| `LIQUIDATION_COOLDOWN_SECS` | 90 days | same |
