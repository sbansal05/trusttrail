# Security Model

What TrustTrail protects, what it trusts, and where its limits are today. TrustTrail runs on devnet and has **not been audited**.

## What the code guarantees

### Lenders' money

- **Every loan is fully collateralized.** A loan opens only if the collateral is worth at least 120–150% of it, valued at the low end of Pyth's confidence range.
- **Prices must be fresh and verified.** Only fully verified Pyth `PriceUpdateV2` accounts, owned by the Pyth receiver, for the configured feed, at most 60 seconds old.
- **Liquidation is open to anyone** once collateral falls below its threshold (110% SOL, 105% tUSDC) or a loan is 3 days past due, with a 5% (SOL) or 2% (tUSDC) bonus as the incentive.
- **A borrower cannot block their own liquidation.** Any collateral left after a liquidation goes to a token account of the borrower's for that mint, and anyone can create one (for example the borrower's associated token account), so closing token accounts does not stop a liquidation.
- **Only classic SPL Token mints.** Every token account is checked as an SPL Token account, so Token-2022 mints (PYUSD, for example) are refused. This also keeps transfer-fee tokens from breaking the pool's accounting.
- **Bad debt hits the reserve first.** 10% of all interest is kept as a first-loss reserve; lenders lose only what it cannot cover, and the loss is tracked in `bad_debt`.
- **Withdrawals stay possible.** New loans stop at 90% utilization.
- **Rounding favours the pool.** Debt rounds up; shares minted and USDC paid out round down.
- **Risk parameters are checked.** A collateral's liquidation threshold must leave room for its bonus and sit below every tier's required ratio, so no loan can be liquidatable at open.


### Borrowers' records

- **Only whitelisted writers can change a score.** `record_event` and `set_imported_score` check the signer against the whitelist (at most 10, managed by the admin, removable at once with `remove_writer`).
- **Pool records cannot be skipped.** The pool writes the record in the same transaction as the repayment or liquidation; if the record fails, the whole transaction fails.
- **One attestation per loan.** The attestation address is derived from the Loan account, so the same loan cannot be recorded twice.
- **No backdating.** The close time is the on-chain clock.
- **An import needs the wallet's consent.** `set_imported_score` requires the wallet's own signature next to the writer's, and only once every 15 days.
- **Bad native history cannot hide behind an import.** The native share of the score grows with every meaningful native loan and with every liquidation or default ([blend](scoring-model.md#4-blending-with-imported-history)).
- **Farming is expensive.** Loans of $100 or less carry no weight, weight grows only with the log of the principal, a loan counts in full only after 24 hours (and raises the native share only then), and same-transaction loans are dropped from imports. Each loan that counts costs a day of interest on real collateral.

## What it trusts

| Trusted | For | If it went wrong | Today's mitigation |
| --- | --- | --- | --- |
| Whitelisted writers | Telling the truth about loans they record | A writer could record loans that never happened, for any wallet | Admin approves every writer; `remove_writer`; the pool's writer is a PDA only its program code can sign for |
| Backend import key | Honest import scores | It could import an inflated score for a wallet that co-signs, or call `record_event` itself | Separate key from the admin and the upgrade authority; every import and every loan it counted is public (`GET /import-history`); removable from the whitelist |
| Price sources for imports | Binance and Birdeye prices at each loan's peak | A wrong price changes a loan's weight | Price, source, time and gap are stored with every loan |
| Pyth | Collateral prices | A wrong price could open an undercollateralized loan or allow an unfair liquidation | Verified updates only, 60 s max age, low end of the confidence range |
| Admin key | Whitelist and collateral list; until 31 Dec 2026, lowering a wallet's stored exposure (`set_exposure`) | Could add a dishonest writer or a bad collateral; could lower a wallet's exposure so its native record counts less | Not stored on the backend; `set_exposure` can only lower exposure and stops working after 31 Dec 2026 |
| Program upgrade authority | Program code, and picking the admin (only it can call `initialize`) | Could deploy different code | Devnet only; upgrades are public on the explorer |
| tUSDC mint authority (faucet key) | Minting the devnet test token | Could mint any amount of tUSDC | Devnet test token only; tUSDC has no freeze authority |
| USDC issuer (Circle), on a future mainnet | Not freezing the pool's vault | Mainnet USDC has a freeze authority that could freeze the vault | Not relevant on devnet (tUSDC) |

## Known limits

- **Not audited.** Programs are covered by 117 unit and LiteSVM integration tests and run on devnet only.
- **The share price counts tokens sent straight to the vault.** Total assets read the vault balance, so a donation raises the share price. `ZeroShares` stops only a deposit that would mint no shares; on a new, empty pool a first depositor could still take part of the next deposit (1 share, then a donation of half the next deposit: that deposit also gets 1 share). The setup script creates the pool and makes the first 10,000 tUSDC deposit in one transaction, so nobody can get in between. Virtual or dead shares, or internal cash accounting, are left for mainnet.
- **Imported history is trusted through the backend.** The plan is to verify it on-chain, or drop the import once native records are enough.
- **Imported liquidations do not block tiers.** They lower the imported score, but only native liquidations set the 90-day Silver/Gold block.
- **Unpriced loans are left out of an import,** including their liquidations.
- **Some import prices assume 1 USDT = $1.**
- **`liquidated_loans` counts liquidations and defaults together.** The score itself treats them differently (2× and 3× penalties); only this counter merges them.
- **The cached score in the account can lag** behind the live one (it can only be stricter). The pool always recomputes; other readers should do the same if they need the exact value ([Lender Integration](lender-integration.md#cached-or-live)).
- **Free Render instance.** The backend sleeps after 15 minutes idle; the first request can take about a minute. The programs and Northwind's read path do not depend on it.

## Keys and secrets

| Key | Where | Never |
| --- | --- | --- |
| Backend writer key, faucet key | Render environment variables | in git, in the app bundle |
| Helius, Pyth Hermes, Birdeye API keys | Render environment variables | in `VITE_` variables (those ship to the browser) |
| Admin and upgrade authority | developer machine | on the backend |
| Program keypairs | developer machine | in git |

## Reporting an issue

Open an issue on [GitHub](https://github.com/sbansal05/trusttrail/issues). For anything that could put funds at risk on a future mainnet deployment, ask for a private contact in the issue instead of posting details.