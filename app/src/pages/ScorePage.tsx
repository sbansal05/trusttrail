import { Link } from "react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { getScore, type Coverage, type Factors, type Gate, type ScoreView } from "../api";
import { useAsync } from "../useAsync";
import { PROTOCOLS, PROTOCOL_LABELS, day, pctBps, tierLabel, usd6 } from "../format";
import { RecordsTable } from "../components/RecordsTable";

const SCORE_MAX = 1000;
const TIER_MARKS = [{ name: "Silver", at: 500 }, { name: "Gold", at: 750 }];

export function ScorePage() {
    const { publicKey } = useWallet();
    const wallet = publicKey?.toBase58() ?? null;
    const { data, error, loading } = useAsync(wallet, getScore);

    if (!wallet) {
        return (
            <main className="tt-page tt-page-narrow">
                <h1 className="tt-display" style={{ fontSize: 36 }}>Your TrustTrail score</h1>
                <p className="tt-muted">Connect a wallet to see its score, what it needs for the next tier, and its repayment records.</p>
                <div><WalletMultiButton /></div>
            </main>
        );
    }
    if (error) return <main className="tt-page"><p className="tt-error">Could not load the score: {error.message}</p></main>;
    if (loading || !data) return <main className="tt-page"><p className="tt-muted">Loading the score…</p></main>;

    return (
        <main className="tt-page">
            <div className="tt-row">
                <ScoreCard view={data} />
                <NextTierCard factors={data.factors} />
            </div>
            <FactorsCard factors={data.factors} />
            <div className="tt-row">
                <CoverageCard coverage={data.coverage} asOf={data.asOf} />
                <section className="tt-card" style={{ flex: "2 1 520px" }} aria-labelledby="rec-h">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                        <h2 id="rec-h" className="tt-title">On-chain records</h2>
                        <Link to={`/record/${wallet}`}>Share public record</Link>
                    </div>
                    <p className="tt-muted">Every pool loan leaves a public Solana Attestation Service record any lender can read.</p>
                    <RecordsTable records={data.attestations} compact />
                </section>
            </div>
        </main>
    );
}

function ScoreCard({ view }: { view: ScoreView }) {
    const fill = `${Math.min(view.score / SCORE_MAX, 1) * 100}%`;
    return (
        <section className="tt-card" aria-labelledby="score-h">
            <h2 id="score-h" className="tt-eyebrow">Your score</h2>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span className="tt-display" style={{ fontSize: 88, lineHeight: 1 }}>{view.score}</span>
                <span className="tt-muted" style={{ fontSize: 18 }}>/ {SCORE_MAX}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="tt-pill" style={{ fontWeight: 600, fontSize: 14, padding: "6px 14px" }}>{tierLabel(view.tierName)}</span>
                <span className="tt-muted">
                    {view.exists ? `Last update ${day(view.lastUpdate)}` : "No TrustTrail account yet"}
                </span>
            </div>
            <div
                style={{ height: 8, borderRadius: 999, background: "var(--tt-surface-raised)", position: "relative" }}
                role="img"
                aria-label={`Score ${view.score} of ${SCORE_MAX}; Silver from 500, Gold from 750`}
            >
                <div style={{ position: "absolute", inset: 0, width: fill, borderRadius: 999, background: "var(--tt-accent)" }} />
                {TIER_MARKS.map((m) => (
                    <div key={m.name} style={{ position: "absolute", left: `${(m.at / SCORE_MAX) * 100}%`, top: -4, width: 2, height: 16, background: "var(--tt-text-muted)" }} />
                ))}
            </div>
            <div className="tt-mono tt-muted" style={{ position: "relative", height: 18, fontSize: 12 }}>
                <span style={{ position: "absolute", left: 0 }}>0</span>
                {TIER_MARKS.map((m) => (
                    <span key={m.name} style={{ position: "absolute", left: `${(m.at / SCORE_MAX) * 100}%`, transform: "translateX(-50%)" }}>
                        {m.name} {m.at}
                    </span>
                ))}
                <span style={{ position: "absolute", right: 0 }}>{SCORE_MAX}</span>
            </div>
        </section>
    );
}

/** One gate of the next tier as a sentence plus what the wallet has against what it needs. */
function gateText(g: Gate): { label: string; value: string } {
    switch (g.gate) {
        case "score":
            return { label: `Score at least ${g.need}`, value: `have ${g.have} · need ${g.need}` };
        case "meaningfulOnTime":
            return { label: "Meaningful loans repaid on time", value: `have ${g.have} · need ${g.need}` };
        case "meaningfulWeightBps":
            return {
                label: "Weight of those loans",
                value: `have ${(Number(g.have) / 10_000).toFixed(1)} · need ${(Number(g.need) / 10_000).toFixed(1)}`,
            };
        case "noLiquidationFor90Days":
            return { label: "No liquidation in the last 90 days", value: g.met ? "clear" : `blocked until ${day(g.blockedUntil)}` };
    }
}

function NextTierCard({ factors }: { factors: Factors }) {
    const next = factors.nextTier;
    if (!next) {
        return (
            <section className="tt-card tt-card-accent">
                <h2 className="tt-eyebrow" style={{ color: "var(--tt-link)" }}>Top tier</h2>
                <p className="tt-display" style={{ fontSize: 26 }}>Gold: the best terms the pool offers</p>
            </section>
        );
    }
    return (
        <section className="tt-card tt-card-accent" aria-labelledby="next-h">
            <h2 id="next-h" className="tt-eyebrow" style={{ color: "var(--tt-link)" }}>Next tier: {tierLabel(next.tier)}</h2>
            <ul className="tt-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {next.gates.map((g) => {
                    const t = gateText(g);
                    return (
                        <li key={g.gate} style={{ padding: "12px 14px", borderRadius: 10, background: "var(--tt-surface)", border: "1px solid var(--tt-surface-line)" }}>
                            <span>{t.label}</span>
                            <span className="tt-mono" style={{ color: g.met ? "var(--tt-success)" : "var(--tt-warning)" }}>{t.value}</span>
                        </li>
                    );
                })}
            </ul>
            <p className="tt-muted">
                Import your lending history from Kamino, MarginFi, Save, Jupiter Lend and Loopscale, or repay pool loans of $100+ held at least 24 h.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Link to="/score/import" className="tt-button-primary" style={{ padding: "0 22px", minHeight: 44, borderRadius: 8 }}>Import history</Link>
            </div>
        </section>
    );
}

function FactorsCard({ factors }: { factors: Factors }) {
    const b = factors.blend;
    const tiles = [
        { label: "Native part", value: String(factors.native), note: "from TrustTrail pool loans" },
        { label: "Imported part", value: String(factors.imported), note: factors.importDate ? `imported ${day(factors.importDate)}` : "no import yet" },
        {
            label: "Blend",
            value: `${pctBps(b.nativeShareBps, 0)} / ${pctBps(b.importedShareBps, 0)}`,
            note: `native / imported (exposure ${(Number(b.exposureBps) / 10_000).toFixed(1)} of ${(Number(b.fullWeightBps) / 10_000).toFixed(1)})`,
        },
        { label: "Meaningful loans", value: `${factors.meaningful.onTime} on time`, note: "$100+ and held 24 h+" },
    ];
    const liq = factors.liquidation;
    return (
        <section className="tt-card" aria-labelledby="fac-h">
            <h2 id="fac-h" className="tt-title">How the score is made</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                {tiles.map((t) => (
                    <div key={t.label} className="tt-tile">
                        <span className="tt-muted">{t.label}</span>
                        <span className="tt-big">{t.value}</span>
                        <span className="tt-muted" style={{ fontSize: 13 }}>{t.note}</span>
                    </div>
                ))}
            </div>
            <p className="tt-muted">
                {liq.last === 0
                    ? "No liquidation on record."
                    : liq.blockedUntil
                      ? `Last liquidation ${day(liq.last)}: the next tier stays closed until ${day(liq.blockedUntil)}.`
                      : `Last liquidation ${day(liq.last)}, more than 90 days ago: it no longer blocks a tier.`}
            </p>
        </section>
    );
}

function CoverageCard({ coverage, asOf }: { coverage: Coverage; asOf: number }) {
    const byProtocol = new Map(coverage.protocols.map((p) => [p.protocol, p]));
    const next = coverage.nextImportAt;
    return (
        <section className="tt-card" style={{ flex: "1 1 340px" }} aria-labelledby="cov-h">
            <h2 id="cov-h" className="tt-title">Coverage</h2>
            <p className="tt-muted">
                {coverage.importedAt ? `Latest import ${day(coverage.importedAt)}.` : "No import yet."}{" "}
                {next && next > asOf ? `Next import ${day(next)}.` : "Next import: available now."}
            </p>
            <ul className="tt-list">
                {PROTOCOLS.map((p) => {
                    const c = byProtocol.get(p);
                    return (
                        <li key={p}>
                            <span>{PROTOCOL_LABELS[p]}</span>
                            <span className="tt-muted">
                                {!c ? "not checked" : c.loans === 0 ? "checked, no loans" : `${c.loans} loans · ${usd6(c.usdMicro)}`}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
