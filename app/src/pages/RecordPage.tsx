import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { PublicKey } from "@solana/web3.js";
import { getLatestImport, getScore, type PublicImport, type ScoreView } from "../api";
import { useAsync } from "../useAsync";
import { explorerTx } from "../config";
import { OUTCOMES, PROTOCOL_LABELS, day, shortAddress, tierLabel, usd6 } from "../format";
import { OutcomePill } from "../components/OutcomePill";
import { RecordsTable } from "../components/RecordsTable";

const isWallet = (s: string) => {
    try {
        new PublicKey(s);
        return true;
    } catch {
        return false;
    }
};

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
        </>
    );
}

function ImportedLoans({ imp }: { imp: PublicImport }) {
    const loans = [...imp.loans].sort((a, b) => b.closedAt - a.closedAt);
    return (
        <>
            <p className="tt-muted">
                Imported {day(imp.computedAt)} (<a href={explorerTx(imp.txSignature)} target="_blank" rel="noreferrer">transaction</a>),
                imported score {imp.score}. Checked: {imp.checkedProtocols.map((p) => PROTOCOL_LABELS[p] ?? p).join(", ")}.
            </p>
            {loans.length === 0 ? (
                <p className="tt-muted">No loans found on those protocols.</p>
            ) : (
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
            )}
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
