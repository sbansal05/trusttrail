import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
    getLender, getPool, getPoolLoans, prepareDeposit, prepareWithdraw,
    type LenderView, type PoolLoansView, type PoolView, type PreparedLender,
} from "../api";
import { explorerTx } from "../config";
import { LOAN_STATES, TIER_LABELS, day, formatUnits, parseUnits, pctBps, shortAddress, tierLabel, units6, usd6 } from "../format";
import { useAsync } from "../useAsync";
import { useSendPrepared } from "../useSendPrepared";

const USDC_DECIMALS = 6;

const loadMarket = async () => {
    const [pool, loans] = await Promise.all([getPool(), getPoolLoans()]);
    return { pool, loans };
};

/** The lender's screen: the pool's size and yield, every open loan, how each tier has repaid, and deposit / withdraw. */
export function PoolPage() {
    const { publicKey } = useWallet();
    const wallet = publicKey?.toBase58() ?? null;
    const market = useAsync("pool", loadMarket);
    const lender = useAsync(wallet, getLender);
    const refresh = () => {
        market.reload();
        lender.reload();
    };

    if (market.error) return <main className="tt-page"><p className="tt-error">Could not load the pool: {market.error.message}</p></main>;
    if (!market.data) return <main className="tt-page"><p className="tt-muted">Loading the pool…</p></main>;
    const { pool, loans } = market.data;

    return (
        <main className="tt-page">
            <PoolStats pool={pool} />
            <div className="tt-row" style={{ alignItems: "flex-start" }}>
                <section className="tt-card" style={{ flex: "999 1 560px" }} aria-labelledby="pos-h">
                    <h2 id="pos-h" className="tt-title">Your position</h2>
                    {!wallet ? (
                        <>
                            <p className="tt-muted">Connect a wallet to deposit tUSDC and earn what borrowers pay.</p>
                            <div><WalletMultiButton /></div>
                        </>
                    ) : lender.error ? (
                        <p className="tt-error">Could not load your position: {lender.error.message}</p>
                    ) : !lender.data ? (
                        <p className="tt-muted">Loading your position…</p>
                    ) : (
                        <Position wallet={wallet} me={lender.data} onChanged={refresh} />
                    )}
                </section>
                <TierRates pool={pool} />
            </div>
            <OpenLoans loans={loans} />
            <TrackRecord loans={loans} />
        </main>
    );
}

function PoolStats({ pool }: { pool: PoolView }) {
    return (
        <section className="tt-card" aria-label="The pool">
            <div className="tt-stack" style={{ gap: 4 }}>
                <span className="tt-eyebrow">Lend tUSDC</span>
                <span className="tt-display" style={{ fontSize: 30 }}>Lenders earn {pctBps(pool.lenderApyBps, 2)} APY</span>
                <span className="tt-muted">
                    What borrowers pay on the tUSDC that is lent out, less the protocol's {pctBps(pool.reserveFactorBps, 0)}. It rises as more of
                    the pool is lent.
                </span>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Tile label="Pool size" value={usd6(pool.totalAssetsUsdc)} />
                <Tile label="Lent out" value={usd6(pool.totalBorrowedUsdc)} />
                <Tile label="Available" value={usd6(pool.idleUsdc)} />
                <Tile label="Utilization" value={pctBps(pool.utilizationBps)} />
                <Tile label="Bad debt" value={usd6(pool.badDebtUsdc)} />
            </div>
        </section>
    );
}

const Tiles = ({ children }: { children: ReactNode }) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>{children}</div>
);

const Tile = ({ label, value }: { label: string; value: string }) => (
    <div className="tt-tile">
        <span className="tt-muted">{label}</span>
        <span className="tt-big">{value}</span>
    </div>
);

function TierRates({ pool }: { pool: PoolView }) {
    return (
        <section className="tt-card" style={{ flex: "1 1 320px" }} aria-labelledby="rates-h">
            <h2 id="rates-h" className="tt-title">What each tier pays</h2>
            <ul className="tt-list">
                {pool.tiers.map((t) => (
                    <li key={t.tier} style={{ alignItems: "baseline" }}>
                        <span className="tt-stack" style={{ gap: 2 }}>
                            <span>{tierLabel(t.name)}</span>
                            <span className="tt-muted" style={{ fontSize: 13 }}>up to ${units6(t.maxLoanUsdc, 0)} · {pctBps(t.collateralBps, 0)} collateral</span>
                        </span>
                        <span className="tt-mono">{pctBps(t.aprBps)} APR</span>
                    </li>
                ))}
            </ul>
            <p className="tt-muted" style={{ fontSize: 13 }}>Better tiers pay less and lock less collateral, because their record says they repay.</p>
        </section>
    );
}

function Position({ wallet, me, onChanged }: { wallet: string; me: LenderView; onChanged: () => void }) {
    const everyShareCanLeave = BigInt(me.withdrawableUsdc) === BigInt(me.valueUsdc);
    return (
        <>
            <Tiles>
                <Tile label="Your shares are worth" value={`${units6(me.valueUsdc)} tUSDC`} />
                <Tile label="Share of the pool" value={pctBps(me.shareOfPoolBps, 2)} />
                <Tile label="You can withdraw now" value={`${units6(me.withdrawableUsdc)} tUSDC`} />
            </Tiles>
            <div className="tt-row">
                <AmountForm
                    title="Deposit"
                    note={`You have ${units6(me.tusdc)} tUSDC. You get pool shares; they grow as borrowers pay interest.`}
                    max={me.tusdc}
                    maxIsAll={false}
                    action={(amount) => prepareDeposit(wallet, amount)}
                    done={(r) => `Deposited ${units6(r.amountUsdc)} tUSDC for about ${units6(r.shares)} shares.`}
                    onChanged={onChanged}
                />
                <AmountForm
                    title="Withdraw"
                    note="Paid from the tUSDC that is not lent out; the rest comes back as loans are repaid."
                    max={me.withdrawableUsdc}
                    maxIsAll={everyShareCanLeave}
                    action={(amount) => prepareWithdraw(wallet, amount)}
                    done={(r) => `Withdrew ${units6(r.amountUsdc)} tUSDC for ${units6(r.shares)} shares.`}
                    onChanged={onChanged}
                />
            </div>
        </>
    );
}

/**
 * One amount in tUSDC, a Max button and a submit. When `maxIsAll`, Max sends "all" so every share is
 * burned and no dust is left behind; typing a new amount after Max goes back to a plain amount.
 */
function AmountForm(props: {
    title: string;
    note: string;
    max: string;
    maxIsAll: boolean;
    action: (amount: string) => Promise<PreparedLender>;
    done: (r: PreparedLender) => string;
    onChanged: () => void;
}) {
    const send = useSendPrepared();
    const [text, setText] = useState("");
    const [all, setAll] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [signature, setSignature] = useState<string | null>(null);

    const amount = parseUnits(text, USDC_DECIMALS);
    const valid = all || (amount !== null && amount > 0n);
    const id = `${props.title.toLowerCase()}-amount`;

    async function submit() {
        if (!valid) return;
        setBusy(true);
        setError(null);
        setSignature(null);
        try {
            setStatus("Preparing…");
            const r = await props.action(all ? "all" : amount!.toString());
            setStatus("Approve in your wallet…");
            const sigs = await send(r.transactions);
            setSignature(sigs.at(-1) ?? null);
            setStatus(props.done(r));
            setText("");
            setAll(false);
            props.onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setStatus(null);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="tt-stack" style={{ gap: 10 }}>
            <label htmlFor={id} style={{ fontWeight: 600 }}>{props.title}</label>
            <div style={{ display: "flex", gap: 8 }}>
                <input
                    id={id} value={text} inputMode="decimal" placeholder="0.00" style={{ flex: 1, minWidth: 0 }}
                    onChange={(e) => { setText(e.target.value); setAll(false); }}
                />
                <button type="button" onClick={() => { setText(formatUnits(props.max, USDC_DECIMALS)); setAll(props.maxIsAll); }}>Max</button>
            </div>
            <span className="tt-muted" style={{ fontSize: 13 }}>{props.note}</span>
            <button className="tt-button-primary" onClick={submit} disabled={!valid || busy}>
                {busy ? "Working…" : `${props.title} ${text || 0} tUSDC`}
            </button>
            {status && (
                <p className="tt-muted" role="status">
                    {status} {signature && <a href={explorerTx(signature)} target="_blank" rel="noreferrer">View</a>}
                </p>
            )}
            {error && <p className="tt-error" role="alert">{error}</p>}
        </div>
    );
}

function OpenLoans({ loans }: { loans: PoolLoansView }) {
    return (
        <section className="tt-card" aria-labelledby="open-h">
            <h2 id="open-h" className="tt-title">Open loans</h2>
            {loans.open.length === 0 ? (
                <p className="tt-muted">No open loans right now.</p>
            ) : (
                <div className="tt-table-wrap">
                    <table className="tt-table">
                        <thead>
                            <tr>
                                <th>Borrower</th><th>Tier</th><th>Principal</th><th>Owes now</th><th>Collateral</th><th>Health</th><th>Due</th><th>State</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loans.open.map((l) => (
                                <tr key={l.address}>
                                    <td className="tt-mono"><Link to={`/record/${l.borrower}`}>{shortAddress(l.borrower)}</Link></td>
                                    <td>{TIER_LABELS.at(l.tierAtOpen) ?? l.tierAtOpen}</td>
                                    <td className="tt-mono">{units6(l.principalUsdc)}</td>
                                    <td className="tt-mono">{units6(l.debtUsdc)}</td>
                                    <td className="tt-mono">{formatUnits(l.collateral.amount, l.collateral.decimals, 4)} {l.collateral.symbol}</td>
                                    <td className="tt-mono">{l.healthBps === null ? "—" : pctBps(l.healthBps, 0)}</td>
                                    <td>{day(l.dueAt)}</td>
                                    <td><span className={`tt-pill tt-pill-${LOAN_STATES[l.state].tone}`}>{LOAN_STATES[l.state].text}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function TrackRecord({ loans }: { loans: PoolLoansView }) {
    return (
        <section className="tt-card" aria-labelledby="track-h">
            <h2 id="track-h" className="tt-title">How each tier has repaid</h2>
            <p className="tt-muted">Every loan this pool has made, by the borrower's tier when it opened. If the tiers work, better tiers default less.</p>
            <div className="tt-table-wrap">
                <table className="tt-table">
                    <thead>
                        <tr><th>Tier</th><th>Loans</th><th>Lent</th><th>Open</th><th>Repaid</th><th>Liquidated</th><th>Defaulted</th></tr>
                    </thead>
                    <tbody>
                        {loans.byTier.map((t) => (
                            <tr key={t.tier}>
                                <td>{tierLabel(t.name)}</td>
                                <td className="tt-mono">{t.loans}</td>
                                <td className="tt-mono">{usd6(t.lentUsdc)}</td>
                                <td className="tt-mono">{t.open}</td>
                                <td className="tt-mono">{t.repaid}</td>
                                <td className="tt-mono">{t.liquidated}</td>
                                <td className="tt-mono">{t.defaulted}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="tt-muted" style={{ fontSize: 13 }}>
                Repaid counts on-time and late repays together; each borrower's public record says which. As of {day(loans.asOf)}.
            </p>
        </section>
    );
}