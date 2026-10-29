import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, getImportPreview, getLatestImport, getScore, type ImportPreview, type PublicImport, type PublicLoan, type ScoreView } from "../api";
import { useAsync } from "../useAsync";
import { explorerTx } from "../config";
import { OUTCOMES, PROTOCOLS, PROTOCOL_LABELS, ago, dateTime, day, shortAddress, tierLabel, usd6, isWallet } from "../format";
import { OutcomePill } from "../components/OutcomePill";
import { RecordsTable } from "../components/RecordsTable";



const loadRecord = async (wallet: string): Promise<{ score: ScoreView; latestImport: PublicImport | null }> => {
    const [score, latestImport] = await Promise.all([getScore(wallet), getLatestImport(wallet)]);
    return { score, latestImport };
};

/** /record and /record/:wallet: anyone can open it, no wallet needed. */
export function RecordPage() {
    const { wallet } = useParams();
    const valid = wallet !== undefined && isWallet(wallet);
    const { data, error, loading } = useAsync(valid ? wallet : null, loadRecord);
    const [copied, setCopied] = useState(false);

    if (!wallet) {
        return (
            <main className="tt-page tt-page-narrow">
                <h1 className="tt-display" style={{ fontSize: 36 }}>Look up a repayment record</h1>
                <p className="tt-muted">Any wallet's TrustTrail record is public. Paste an address to see its score, its pool loans and its imported history.</p>
                <LookupForm />
            </main>
        );
    }
    if (!valid) return <main className="tt-page"><p className="tt-error">That is not a Solana address.</p><LookupForm /></main>;

    async function copy() {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
    }

    return (
        <main className="tt-page">
            <div className="tt-stack" style={{ gap: 8 }}>
                <span className="tt-eyebrow">Public repayment record · no wallet needed</span>
                <h1 className="tt-mono" style={{ fontSize: 24, fontWeight: 500, wordBreak: "break-all" }}>{wallet}</h1>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={copy}>{copied ? "Link copied" : "Copy link"}</button>
                    <LookupForm compact />
                </div>
            </div>

            {error && <p className="tt-error">Could not load the record: {error.message}</p>}
            {(loading || !data) && !error && <p className="tt-muted">Loading the record…</p>}
            {data && <RecordBody score={data.score} latestImport={data.latestImport} />}
        </main>
    );
}

function RecordBody({ score, latestImport }: { score: ScoreView; latestImport: PublicImport | null }) {
    const counts = OUTCOMES.map((o, i) => ({ label: o.label, n: score.attestations.filter((r) => r.outcome === i).length }));
    return (
        <>
            <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }} aria-label="Summary">
                <div className="tt-tile" style={{ flexBasis: 220 }}>
                    <span className="tt-muted">Score · tier</span>
                    <span className="tt-big">{score.score} · {tierLabel(score.tierName)}</span>
                </div>
                {counts.map((c) => (
                    <div key={c.label} className="tt-tile" style={{ flexBasis: 140 }}>
                        <span className="tt-muted">{c.label}</span>
                        <span className="tt-big">{c.n}</span>
                    </div>
                ))}
            </section>

            <p className="tt-muted">
                Any lender can read this record from Solana. <Link to={`/partner/${score.wallet}`}>See what Northwind Lend, a demo lender, offers this wallet</Link>.
            </p>

            <section className="tt-card" aria-labelledby="att-h">
                <h2 id="att-h" className="tt-title">Pool loans (attestations)</h2>
                <p className="tt-muted">
                    Signed by TrustTrail's attester on the Solana Attestation Service. Each record links to its account on Solana
                    Explorer, so you can check it without trusting this page.
                </p>
                <RecordsTable records={score.attestations} />
            </section>

            <section className="tt-card" aria-labelledby="imp-h">
                <h2 id="imp-h" className="tt-title">Imported history</h2>
                {latestImport ? <ImportedLoans imp={latestImport} /> : <p className="tt-muted">This wallet has not imported loans from other protocols yet.</p>}
            </section>

            <ImportPreviewCard key={score.wallet} wallet={score.wallet} />
        </>
    );
}

const protocolNames = (protocols: string[]) => protocols.map((p) => PROTOCOL_LABELS[p] ?? p).join(", ");

function ImportedLoans({ imp }: { imp: PublicImport }) {
    return (
        <>
            <p className="tt-muted">
                Imported {day(imp.computedAt)} (<a href={explorerTx(imp.txSignature)} target="_blank" rel="noreferrer">transaction</a>),
                imported score {imp.score}. Checked: {protocolNames(imp.checkedProtocols)}.
            </p>
            <LoansTable loans={imp.loans} />
        </>
    );
}

/** Imported or previewed loans, newest closed first. */
function LoansTable({ loans: unsorted }: { loans: PublicLoan[] }) {
    if (unsorted.length === 0) return <p className="tt-muted">No loans found on those protocols.</p>;
    const loans = [...unsorted].sort((a, b) => b.closedAt - a.closedAt);
    return (
        <div className="tt-table-wrap">
            <table className="tt-table">
                <thead>
                    <tr>
                        <th>Protocol</th>
                        <th>Opened</th>
                        <th>Closed</th>
                        <th>Peak debt</th>
                        <th>Outcome</th>
                        <th>Closing tx</th>
                    </tr>
                </thead>
                <tbody>
                    {loans.map((l) => (
                        <tr key={`${l.position}:${l.signatures.open}`}>
                            <td>{PROTOCOL_LABELS[l.protocol] ?? l.protocol}</td>
                            <td>{day(l.openedAt)}</td>
                            <td>{day(l.closedAt)}</td>
                            <td className="tt-mono">{l.usdMicro ? usd6(l.usdMicro) : "no price"}</td>
                            <td><OutcomePill outcome={l.outcome} /></td>
                            <td className="tt-mono">
                                <a href={explorerTx(l.signatures.end)} target="_blank" rel="noreferrer">{shortAddress(l.signatures.end)}</a>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Read-only: what an import would give this wallet. Reads only on a click, since a fresh read spends API credits. */
function ImportPreviewCard({ wallet }: { wallet: string }) {
    const [asked, setAsked] = useState(false);
    const { data, error, loading, reload } = useAsync(asked ? wallet : null, getImportPreview);
    return (
        <section className="tt-card" aria-labelledby="prev-h">
            <span className="tt-eyebrow">Preview only, not a TrustTrail record</span>
            <h2 id="prev-h" className="tt-title">Import preview</h2>
            <p className="tt-muted">
                What an import would find for this wallet, priced and scored the same way. Nothing is written on-chain.
            </p>
            {!asked && <div><button onClick={() => setAsked(true)}>Preview an import</button></div>}
            {loading && <p className="tt-muted" role="status">Reading history from {PROTOCOLS.length} protocols… up to a minute</p>}
            {error && (
                <>
                    <p className="tt-error" role="alert">{previewError(error)}</p>
                    <div><button onClick={reload}>Try again</button></div>
                </>
            )}
            {data && <PreviewBody preview={data} />}
        </section>
    );
}

function previewError(err: Error): string {
    const retryAt = err instanceof ApiError ? err.body.retryAt : undefined;
    return typeof retryAt === "number" ? `${err.message} (after ${dateTime(retryAt)}).` : `Could not preview: ${err.message}`;
}

function PreviewBody({ preview: p }: { preview: ImportPreview }) {
    const c = p.counts;
    const tiles = [
        { label: "Imported score", value: String(p.score), note: "the imported part only, no tier" },
        {
            label: "Meaningful loans",
            value: `${p.meaningfulOnTime} on time`,
            note: `weight ${(Number(p.meaningfulWeightBps) / 10_000).toFixed(1)} · $100+ and held 24 h+`,
        },
        { label: "Loans found", value: String(c.loans), note: `${c.priced} priced · ${c.unpriced} without a price` },
    ];
    return (
        <>
            <p className="tt-muted">
                Checked {ago(p.computedAt)}{p.cached ? " (saved result)" : ""}: {protocolNames(p.checkedProtocols)}.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                {tiles.map((t) => (
                    <div key={t.label} className="tt-tile">
                        <span className="tt-muted">{t.label}</span>
                        <span className="tt-big">{t.value}</span>
                        <span className="tt-muted" style={{ fontSize: 13 }}>{t.note}</span>
                    </div>
                ))}
            </div>
            {c.unpriced > 0 && (
                <p className="tt-muted">
                    {c.unpriced} loans have no price{c.unpricedLiquidations > 0 ? `, ${c.unpricedLiquidations} of them liquidated or defaulted` : ""}.
                    They are listed below but not scored, so they neither raise nor lower this score.
                </p>
            )}
            {c.sameTransaction > 0 && <p className="tt-muted">{c.sameTransaction} loans opened and repaid in one transaction were skipped.</p>}
            {p.historyCapped && (
                <p className="tt-muted" style={{ color: "var(--tt-warning)" }}>
                    This wallet has more history than one read covers, so older loans may be missing.
                </p>
            )}
            <LoansTable loans={p.loans} />
        </>
    );
}


function LookupForm({ compact = false }: { compact?: boolean }) {
    const navigate = useNavigate();
    const [value, setValue] = useState("");
    const ok = isWallet(value.trim());
    function go(e: FormEvent) {
        e.preventDefault();
        if (ok) navigate(`/record/${value.trim()}`);
    }
    return (
        <form onSubmit={go} style={{ display: "flex", gap: 12, flexWrap: "wrap", flex: compact ? "1 1 320px" : undefined }}>
            <label htmlFor="lookup" className="tt-sr-only">Wallet address</label>
            <input
                id="lookup"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={compact ? "Check another wallet" : "Wallet address"}
                style={{ flex: "1 1 260px", minWidth: 0 }}
            />
            <button type="submit" disabled={!ok}>Look up</button>
        </form>
    );
}
