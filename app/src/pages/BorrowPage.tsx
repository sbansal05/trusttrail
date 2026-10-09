import { useState } from "react";
import { Link } from "react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
    ApiError, claimFaucet, getLoans, getPool, prepareBorrow,
    type CollateralInfo, type CollateralSymbol, type LoansView, type PoolView,
} from "../api";
import { explorerTx } from "../config";
import { day, formatUnits, parseUnits, pctBps, tierLabel, units6 } from "../format";
import { useAsync } from "../useAsync";
import { useSendPrepared } from "../useSendPrepared";
import { LoanCard } from "../components/LoanCard";

const USDC_DECIMALS = 6;
const LOAN_DAYS = 30;

const loadBorrow = async (wallet: string) => {
    const [loans, pool] = await Promise.all([getLoans(wallet), getPool()]);
    return { loans, pool };
};

export function BorrowPage() {
    const { publicKey } = useWallet();
    const wallet = publicKey?.toBase58() ?? null;
    const { data, error, loading, reload } = useAsync(wallet, loadBorrow);

    if (!wallet) {
        return (
            <main className="tt-page tt-page-narrow">
                <h1 className="tt-display" style={{ fontSize: 36 }}>Borrow tUSDC</h1>
                <p className="tt-muted">Connect a wallet to see its offer: how much it can borrow, at what rate and against how much collateral.</p>
                <div><WalletMultiButton /></div>
            </main>
        );
    }
    if (error) return <main className="tt-page"><p className="tt-error">Could not load the offer: {error.message}</p></main>;
    if (!data) return <main className="tt-page"><p className="tt-muted">{loading ? "Loading your offer…" : ""}</p></main>;

    const { loans, pool } = data;
    return (
        <main className="tt-page">
            <OfferBar loans={loans} pool={pool} />
            {loans.loans.map((l) => (
                <LoanCard key={l.address} wallet={wallet} loan={l} now={loans.asOf} tusdcBalance={loans.balances.tusdc} onChanged={reload} />
            ))}
            <div className="tt-row" style={{ alignItems: "flex-start" }}>
                <BorrowForm wallet={wallet} loans={loans} onBorrowed={reload} />
                <aside className="tt-stack" style={{ flex: "1 1 300px", gap: 16 }}>
                    <Faucet wallet={wallet} balances={loans.balances} onClaimed={reload} />
                    <section className="tt-card" style={{ padding: 24 }} aria-labelledby="why-h">
                        <h2 id="why-h" style={{ fontSize: 17, fontWeight: 600 }}>Better terms come from your record</h2>
                        <p className="tt-muted">
                            {pool.tiers.slice(1).map((t) => `${tierLabel(t.name)}: $${units6(t.maxLoanUsdc, 0)} at ${pctBps(t.collateralBps, 0)}`).join(". ")}.
                            Each tier also pays a lower rate.
                        </p>
                        <Link to="/score">See what you need for the next tier</Link>
                    </section>
                </aside>
            </div>
        </main>
    );
}

function OfferBar({ loans, pool }: { loans: LoansView; pool: PoolView }) {
    const o = loans.offer;
    const growthCapped = BigInt(o.maxLoanUsdc) < BigInt(o.tierMaxLoanUsdc);
    return (
        <section className="tt-card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }} aria-label="Your offer">
            <div className="tt-stack" style={{ gap: 4 }}>
                <span className="tt-eyebrow">Your offer · {tierLabel(o.tierName)}</span>
                <span className="tt-display" style={{ fontSize: 30 }}>Up to ${units6(o.maxLoanUsdc, 0)} at {pctBps(o.aprBps)} APR</span>
                {growthCapped && (
                    <span className="tt-muted">
                        Your tier allows ${units6(o.tierMaxLoanUsdc, 0)}; a new loan can be at most twice your largest on-time repay (at least $100).
                    </span>
                )}
            </div>
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                <Figure label="Collateral" value={pctBps(o.collateralBps, 0)} />
                <Figure label="Pool lent out" value={pctBps(pool.utilizationBps)} />
                <Figure label="Available" value={`$${units6(pool.idleUsdc, 0)}`} />
            </div>
        </section>
    );
}

const Figure = ({ label, value }: { label: string; value: string }) => (
    <div className="tt-stack" style={{ gap: 0 }}>
        <span className="tt-muted">{label}</span>
        <span className="tt-mono" style={{ fontSize: 20 }}>{value}</span>
    </div>
);

/** The collateral the backend will use by default: the tier's ratio plus the buffer, at the display price (rounded up). */
function suggestedCollateral(amount: bigint, o: LoansView["offer"], c: CollateralInfo): string {
    if (!c.price || amount <= 0n) return "";
    const usd = (Number(amount) / 1e6) * (o.collateralBps / 10_000) * (1 + o.collateralBufferBps / 10_000);
    const units = Math.ceil((usd / c.price) * 10 ** c.decimals);
    return formatUnits(BigInt(units), c.decimals, c.decimals);
}

function BorrowForm({ wallet, loans, onBorrowed }: { wallet: string; loans: LoansView; onBorrowed: () => void }) {
    const o = loans.offer;
    const send = useSendPrepared();
    const [symbol, setSymbol] = useState<CollateralSymbol>(o.collaterals[0]?.symbol ?? "SOL");
    const [amountText, setAmountText] = useState(formatUnits(o.maxLoanUsdc, USDC_DECIMALS, 2));
    const [collateralText, setCollateralText] = useState<string | null>(null); // null: use the suggestion
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [signature, setSignature] = useState<string | null>(null);

    const c = o.collaterals.find((x) => x.symbol === symbol);
    const amount = parseUnits(amountText, USDC_DECIMALS);
    const suggestion = c && amount ? suggestedCollateral(amount, o, c) : "";
    const shownCollateral = collateralText ?? suggestion;
    const collateralUnits = c ? parseUnits(shownCollateral, c.decimals) : null;
    const tooMuch = amount !== null && amount > BigInt(o.maxLoanUsdc);
    const valid = c && amount !== null && amount > 0n && !tooMuch && collateralUnits !== null && collateralUnits > 0n;
    const interest = amount ? (Number(amount) / 1e6) * (o.aprBps / 10_000) * (LOAN_DAYS / 365) : 0;

    async function borrow() {
        if (!valid || !c || amount === null) return;
        setBusy(true);
        setError(null);
        setSignature(null);
        try {
            setStatus("Getting a fresh price and preparing the borrow…");
            const prepared = await prepareBorrow(wallet, symbol, amount.toString(), collateralText === null ? undefined : collateralUnits!.toString());
            setStatus(`Approve ${prepared.transactions.length} transactions in your wallet…`);
            const sigs = await send(prepared.transactions, (n, total) => setStatus(`Sent ${n} of ${total}…`));
            setSignature(sigs.at(-1) ?? null);
            setStatus(`Borrowed ${units6(prepared.amountUsdc)} tUSDC against ${formatUnits(prepared.collateralAmount, c.decimals, 4)} ${symbol}.`);
            setCollateralText(null);
            onBorrowed();
        } catch (err) {
            const min = err instanceof ApiError && typeof err.body.minCollateral === "string"
                ? ` The minimum is ${formatUnits(err.body.minCollateral, c.decimals, 4)} ${symbol}.` : "";
            setError((err instanceof Error ? err.message : String(err)) + min);
            setStatus(null);
        } finally {
            setBusy(false);
        }
    }

    if (BigInt(o.maxLoanUsdc) === 0n) {
        return <section className="tt-card" style={{ flex: "999 1 560px" }}><p className="tt-muted">The pool has nothing to lend right now.</p></section>;
    }

    return (
        <section className="tt-card" style={{ flex: "999 1 560px", gap: 20 }} aria-labelledby="bor-h">
            <h1 id="bor-h" className="tt-display" style={{ fontSize: 28 }}>Borrow tUSDC</h1>

            <fieldset style={{ margin: 0, padding: 0, border: "none" }} className="tt-stack">
                <legend className="tt-muted" style={{ marginBottom: 10 }}>Collateral</legend>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {o.collaterals.map((x) => (
                        <label
                            key={x.symbol}
                            className={`tt-card ${x.symbol === symbol ? "tt-card-accent" : ""}`}
                            style={{ flex: "1 1 200px", flexDirection: "row", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer" }}
                        >
                            <input
                                type="radio" name="collateral" checked={x.symbol === symbol}
                                onChange={() => { setSymbol(x.symbol); setCollateralText(null); }}
                                style={{ accentColor: "var(--tt-accent)", width: 18, height: 18 }}
                            />
                            <span className="tt-stack" style={{ gap: 0 }}>
                                <span style={{ fontWeight: 600 }}>{x.symbol}</span>
                                <span className="tt-muted" style={{ fontSize: 13 }}>
                                    liquidated below {pctBps(x.liqThresholdBps, 0)} · {x.price ? `$${x.price.toFixed(x.price < 10 ? 4 : 2)}` : "no price"}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="tt-stack" style={{ gap: 8 }}>
                <label htmlFor="amt" className="tt-muted">Amount (tUSDC), up to {units6(o.maxLoanUsdc, 0)}</label>
                <input id="amt" value={amountText} inputMode="decimal" onChange={(e) => { setAmountText(e.target.value); setCollateralText(null); }} style={{ fontSize: 24 }} />
                {tooMuch && <span className="tt-error">Above your limit of {units6(o.maxLoanUsdc, 0)} tUSDC.</span>}
            </div>

            <div className="tt-stack" style={{ gap: 8 }}>
                <label htmlFor="col" className="tt-muted">
                    Collateral to lock ({symbol}). Pre-filled with {pctBps(o.collateralBps, 0)} of the loan plus {pctBps(o.collateralBufferBps, 0)}; more makes the loan safer.
                </label>
                <input id="col" value={shownCollateral} inputMode="decimal" onChange={(e) => setCollateralText(e.target.value)} />
                {c?.symbol === "tUSDC" && <span className="tt-muted" style={{ fontSize: 13 }}>Your tUSDC collateral is kept in a separate account of your wallet, apart from the tUSDC you borrow.</span>}
            </div>

            <dl className="tt-card" style={{ margin: 0, padding: 16, gap: 10, background: "var(--tt-surface-sunk)", fontSize: 14 }}>
                <Row term="Due" detail={`in ${LOAN_DAYS} days, ${day(loans.asOf + LOAN_DAYS * 86_400)}`} />
                <Row term={`Interest at ${pctBps(o.aprBps)} for ${LOAN_DAYS} days`} detail={`≈ ${interest.toFixed(2)} tUSDC`} />
                <Row term="Your balances" detail={`${formatUnits(loans.balances.solLamports, 9, 3)} SOL · ${units6(loans.balances.tusdc)} tUSDC`} />
                <Row term="Price" detail="Pyth, posted fresh with your borrow" />
            </dl>

            <button className="tt-button-primary" style={{ minHeight: 52, fontSize: 16 }} onClick={borrow} disabled={!valid || busy}>
                {busy ? "Working…" : `Borrow ${amountText || 0} tUSDC`}
            </button>
            {status && (
                <p className="tt-muted" role="status">
                    {status} {signature && <a href={explorerTx(signature)} target="_blank" rel="noreferrer">View</a>}
                </p>
            )}
            {error && <p className="tt-error" role="alert">{error}</p>}
            <p className="tt-muted" style={{ fontSize: 13 }}>
                Your wallet asks once for several transactions: post the price, open the loan, close the price account (its rent comes back).
                {!o.hasScoreAccount && " The first one also creates your TrustTrail account."}
            </p>
        </section>
    );
}

const Row = ({ term, detail }: { term: string; detail: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <dt className="tt-muted">{term}</dt>
        <dd className="tt-mono" style={{ margin: 0 }}>{detail}</dd>
    </div>
);

function Faucet({ wallet, balances, onClaimed }: { wallet: string; balances: LoansView["balances"]; onClaimed: () => void }) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    async function claim() {
        setBusy(true);
        try {
            const r = await claimFaucet(wallet);
            setNote(`Sent ${units6(r.amount, 0)} tUSDC. Next claim ${day(r.nextClaimAt)}.`);
            onClaimed();
        } catch (err) {
            const next = err instanceof ApiError && typeof err.body.nextClaimAt === "number" ? ` Next claim ${day(err.body.nextClaimAt)}.` : "";
            setNote((err instanceof Error ? err.message : String(err)) + next);
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="tt-card" style={{ padding: 24, gap: 12 }} aria-labelledby="fau-h">
            <h2 id="fau-h" style={{ fontSize: 17, fontWeight: 600 }}>Need test tUSDC?</h2>
            <p className="tt-muted">1,000 tUSDC to your wallet, once every 24 hours. tUSDC is TrustTrail's devnet test token, not real USDC. You have {units6(balances.tusdc)}.</p>
            <button onClick={claim} disabled={busy} style={{ borderColor: "var(--tt-accent)" }}>{busy ? "Sending…" : "Get 1,000 tUSDC"}</button>
            {note && <p className="tt-muted" role="status">{note}</p>}
            <p className="tt-muted" style={{ fontSize: 13 }}>
                Devnet SOL: <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>
            </p>
        </section>
    );
}