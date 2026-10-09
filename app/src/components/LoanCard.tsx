import { useState } from "react";
import { ApiError, prepareRepay, type LoanView } from "../api";
import { explorerTx } from "../config";
import { LOAN_STATES, day, formatUnits, pctBps, shortAddress, units6 } from "../format";
import { useSendPrepared } from "../useSendPrepared";

const HEALTH_MAX_BPS = 20_000; 



/** One open loan: what is owed, the collateral, its health against the liquidation line, and the repay button. */
export function LoanCard(props: { wallet: string; loan: LoanView; now: number; tusdcBalance: string; onChanged: () => void }) {
    const { loan: l } = props;
    const send = useSendPrepared();
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [signature, setSignature] = useState<string | null>(null);

    const short = BigInt(props.tusdcBalance) < BigInt(l.debtUsdc);
    const daysLeft = Math.ceil((l.dueAt - props.now) / 86_400);
    const state = LOAN_STATES[l.state];

    async function repay() {
        setBusy(true);
        setError(null);
        try {
            setStatus("Preparing the repay…");
            const { transactions } = await prepareRepay(props.wallet, l.address);
            setStatus("Approve in your wallet…");
            const sigs = await send(transactions);
            setSignature(sigs.at(-1) ?? null);
            setStatus("Repaid. Your record now has this loan.");
            props.onChanged();
        } catch (err) {
            const need = err instanceof ApiError && typeof err.body.need === "string" ? ` You need ${units6(err.body.need)} tUSDC.` : "";
            setError((err instanceof Error ? err.message : String(err)) + need);
            setStatus(null);
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="tt-card" aria-label={`Loan ${shortAddress(l.address)}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h2 className="tt-title">Open loan</h2>
                <span className="tt-mono tt-muted" style={{ fontSize: 13 }}>loan {shortAddress(l.address)} · opened {day(l.openedAt)}</span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <Stat label="You owe" value={`${units6(l.debtUsdc, 2)} tUSDC`} note={`principal ${units6(l.principalUsdc)} + interest`} />
                <Stat
                    label="Collateral"
                    value={`${formatUnits(l.collateral.amount, l.collateral.decimals, 4)} ${l.collateral.symbol}`}
                    note={l.collateral.valueUsdc ? `≈ $${units6(l.collateral.valueUsdc)}` : "no price right now"}
                />
                <Stat label="Rate" value={`${pctBps(l.aprBps)} APR`} note="variable, set by how much of the pool is lent" />
                <Stat label="Due" value={day(l.dueAt)} note={daysLeft > 0 ? `${daysLeft} days left` : `grace ends ${day(l.graceEndsAt)}`} />
            </div>

            <HealthBar loan={l} />

            <p><span className={`tt-pill tt-pill-${state.tone}`}>{state.text}</span></p>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <button className="tt-button-primary" onClick={repay} disabled={busy}>{busy ? "Working…" : "Repay in full"}</button>
                {short && <span className="tt-muted">Your tUSDC ({units6(props.tusdcBalance)}) is less than the debt. Use the faucet first.</span>}
            </div>
            {status && <p className="tt-muted" role="status">{status}{signature && <> <a href={explorerTx(signature)} target="_blank" rel="noreferrer">View</a></>}</p>}
            {error && <p className="tt-error" role="alert">{error}</p>}
            <p className="tt-muted">
                Repaying by {day(l.dueAt)} is on time; until {day(l.graceEndsAt)} it is late; after that, defaulted. Either way it becomes a
                public record on your trail.
            </p>
        </section>
    );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
    return (
        <div className="tt-stack" style={{ flex: "1 1 180px", gap: 2 }}>
            <span className="tt-muted">{label}</span>
            <span className="tt-big">{value}</span>
            <span className="tt-muted" style={{ fontSize: 13 }}>{note}</span>
        </div>
    );
}

function HealthBar({ loan: l }: { loan: LoanView }) {
    if (l.healthBps === null || l.liqThresholdBps === null) return <p className="tt-muted">Health is not available: no price for the collateral right now.</p>;
    const at = (bps: number) => `${(Math.min(Math.max(bps - 10_000, 0), HEALTH_MAX_BPS - 10_000) / (HEALTH_MAX_BPS - 10_000)) * 100}%`;
    const safe = l.healthBps >= l.liqThresholdBps;
    return (
        <div className="tt-stack" style={{ gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>Health: {pctBps(l.healthBps, 0)} collateral</span>
                <span className="tt-muted">
                    Liquidation below {pctBps(l.liqThresholdBps, 0)}
                    {l.liquidationPrice !== null && `, when ${l.collateral.symbol} ≤ $${l.liquidationPrice.toFixed(2)}`}
                </span>
            </div>
            <div
                style={{ position: "relative", height: 14, borderRadius: 999, background: "var(--tt-surface-raised)", overflow: "hidden" }}
                role="img"
                aria-label={`Collateral at ${pctBps(l.healthBps, 0)} of the debt; liquidation at ${pctBps(l.liqThresholdBps, 0)}`}
            >
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: at(l.healthBps), background: safe ? "var(--tt-success)" : "var(--tt-danger)" }} />
                <div style={{ position: "absolute", left: at(l.liqThresholdBps), top: 0, bottom: 0, width: 2, background: "var(--tt-text)" }} />
            </div>
            <div className="tt-mono tt-muted" style={{ position: "relative", height: 18, fontSize: 12 }}>
                <span style={{ position: "absolute", left: 0 }}>100%</span>
                <span style={{ position: "absolute", left: at(l.liqThresholdBps), transform: "translateX(-50%)" }}>{pctBps(l.liqThresholdBps, 0)}</span>
                <span style={{ position: "absolute", right: 0 }}>200%+</span>
            </div>
        </div>
    );
}