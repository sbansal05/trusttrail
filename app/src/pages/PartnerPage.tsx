import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { explorerAddress } from "../config";
import { TIER_LABELS, day, isWallet, pctBps, shortAddress, units6 } from "../format";
import { northwindOffer, readRecord, type Adjustment, type TrustTrailRecord } from "../partner";
import { useAsync } from "../useAsync";

const tierName = (t: number) => TIER_LABELS.at(t) ?? `Tier ${t}`;
const signed = (bps: number) => (bps === 0 ? "—" : `${bps > 0 ? "+" : "−"}${pctBps(Math.abs(bps))}`);

/**
 * /partner and /partner/:wallet: Northwind Lend, a made-up second lender with its own header and its own terms.
 * Anyone can check any wallet; the record is read from Solana in the browser, not from TrustTrail's backend.
 */
export function PartnerPage() {
    const { wallet } = useParams();
    const { connection } = useConnection();
    const valid = wallet !== undefined && isWallet(wallet);
    // Wrapped, so "this wallet has no record" (record: null) is not mistaken for "not loaded yet" (data: null).
    const read = useAsync(valid ? wallet : null, async (w) => ({ record: await readRecord(connection, w) }));

    return (
        <>
            <header className="tt-header">
                <div className="tt-header-inner">
                    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                        <span className="tt-brand">Northwind Lend</span>
                        <span className="tt-pill tt-muted">demo lender · not part of TrustTrail</span>
                    </div>
                    <Link to="/">Back to TrustTrail</Link>
                </div>
            </header>
            <main className="tt-page">
                <section className="tt-card" aria-labelledby="nw-h">
                    <span className="tt-eyebrow">Credit check</span>
                    <h1 id="nw-h" className="tt-display" style={{ fontSize: 30 }}>Northwind prices loans from your TrustTrail record</h1>
                    <p className="tt-muted">
                        We read the record straight from Solana. No sign-up, no data-sharing deal with TrustTrail, no wallet signature needed.
                    </p>
                    <WalletPicker current={valid ? wallet : null} />
                </section>
                {wallet !== undefined && !valid && <p className="tt-error">That is not a Solana wallet address.</p>}
                {read.error && <p className="tt-error">Could not read the record: {read.error.message}</p>}
                {valid && !read.data && !read.error && <p className="tt-muted">Reading the record from Solana…</p>}
                {valid && read.data && <Result wallet={wallet} record={read.data.record} />}
            </main>
        </>
    );
}

function WalletPicker({ current }: { current: string | null }) {
    const navigate = useNavigate();
    const { publicKey } = useWallet();
    const [text, setText] = useState(current ?? "");
    const ok = isWallet(text.trim());

    function check(e: FormEvent) {
        e.preventDefault();
        if (ok) navigate(`/partner/${text.trim()}`);
    }

    return (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <form onSubmit={check} style={{ display: "flex", gap: 12, flex: "1 1 460px", minWidth: 0 }}>
                <label htmlFor="nw-wallet" className="tt-sr-only">Wallet address</label>
                <input
                    id="nw-wallet" value={text} onChange={(e) => setText(e.target.value)} placeholder="Any wallet address"
                    className="tt-mono" style={{ flex: 1, minWidth: 0 }}
                />
                <button type="submit" className="tt-button-primary" disabled={!ok}>Check</button>
            </form>
            {/* Outside the form, so the wallet button never submits it. */}
            {publicKey ? (
                <button type="button" onClick={() => { setText(publicKey.toBase58()); navigate(`/partner/${publicKey.toBase58()}`); }}>
                    Use my wallet ({shortAddress(publicKey.toBase58())})
                </button>
            ) : (
                <WalletMultiButton />
            )}
        </div>
    );
}

function Result({ wallet, record }: { wallet: string; record: TrustTrailRecord | null }) {
    const offer = northwindOffer(record, tierName);
    return (
        <div className="tt-row" style={{ alignItems: "flex-start" }}>
            <section className="tt-card" aria-labelledby="read-h">
                <h2 id="read-h" className="tt-title">What we read</h2>
                {record ? (
                    <>
                        <ul className="tt-list">
                            <Fact name="TrustTrail score" value={`${record.score} / 1000`} />
                            <Fact name="Tier" value={tierName(record.tier)} />
                            <Fact name="Repaid on time" value={String(record.onTime)} />
                            <Fact name="Repaid late" value={String(record.late)} />
                            <Fact name="Liquidated" value={String(record.liquidated)} />
                            <Fact name="Total repaid" value={`$${units6(record.totalRepaidUsdc)}`} />
                        </ul>
                        <p className="tt-muted" style={{ fontSize: 13 }}>
                            From the score account{" "}
                            <a className="tt-mono" href={explorerAddress(record.account)} target="_blank" rel="noreferrer">{shortAddress(record.account)}</a>
                            , as the TrustTrail program last wrote it ({day(record.updatedAt)}).
                        </p>
                    </>
                ) : (
                    <p className="tt-muted">
                        {shortAddress(wallet)} has no TrustTrail record yet, so Northwind treats it as a new borrower.
                    </p>
                )}
            </section>
            <section className="tt-card tt-card-accent" aria-labelledby="offer-h">
                <h2 id="offer-h" className="tt-title">Northwind's offer</h2>
                <span className="tt-display" style={{ fontSize: 30 }}>
                    {pctBps(offer.aprBps)} APR · {pctBps(offer.collateralBps, 0)} collateral
                </span>
                <table className="tt-table" style={{ minWidth: 0 }}>
                    <thead><tr><th>How we got there</th><th>APR</th><th>Collateral</th></tr></thead>
                    <tbody>
                        <Line a={offer.base} base />
                        {offer.adjustments.map((a) => <Line key={a.label} a={a} />)}
                    </tbody>
                </table>
                <p className="tt-muted" style={{ fontSize: 13 }}>
                    Northwind's own rules: 0.5% off for every 3 on-time repays (up to 1.5%), 0.5% more for each late one (up to 2%), 10% more
                    collateral after any liquidation. TrustTrail's pool reads the same record and prices it its own way.
                </p>
            </section>
        </div>
    );
}

const Fact = ({ name, value }: { name: string; value: string }) => (
    <li><span className="tt-muted">{name}</span><span className="tt-mono">{value}</span></li>
);

const Line = ({ a, base = false }: { a: Adjustment; base?: boolean }) => (
    <tr>
        <td>{a.label}</td>
        <td className="tt-mono">{base ? pctBps(a.aprBps) : signed(a.aprBps)}</td>
        <td className="tt-mono">{base ? pctBps(a.collateralBps, 0) : a.collateralBps === 0 ? "—" : `+${pctBps(a.collateralBps, 0)}`}</td>
    </tr>
);