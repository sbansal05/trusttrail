import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ApiError, prepareImport, submitImport, type PreparedImport } from "../api";
import { explorerTx } from "../config";
import { PROTOCOLS, PROTOCOL_LABELS, day } from "../format";

type Step =
    | { name: "start" }
    | { name: "signing-message" }
    | { name: "scanning" }
    | { name: "review"; prepared: PreparedImport }
    | { name: "submitting"; prepared: PreparedImport }
    | { name: "done"; prepared: PreparedImport; signature: string };

const ALL_PROTOCOLS = PROTOCOLS.map((p) => PROTOCOL_LABELS[p]).join(", ");

/** Same text the backend checks: proof the caller owns the wallet, valid for 7 minutes. */
const importMessage = (wallet: string, timestamp: number) => `TrustTrail import for ${wallet} at ${timestamp}`;

function explain(err: unknown): string {
    if (err instanceof ApiError) {
        if (err.status === 429 && typeof err.body.nextImportAt === "number") {
            return `You can import again on ${day(err.body.nextImportAt)}.`;
        }
        if (err.status === 401) return "The signed message expired. Start again.";
        return err.message;
    }
    return err instanceof Error ? err.message : String(err);
}

export function ImportPage() {
    const { publicKey, signMessage, signTransaction } = useWallet();
    const [step, setStep] = useState<Step>({ name: "start" });
    const [error, setError] = useState<string | null>(null);

    if (!publicKey) {
        return (
            <main className="tt-page tt-page-narrow">
                <h1 className="tt-display" style={{ fontSize: 36 }}>Bring your lending history</h1>
                <p className="tt-muted">Connect the wallet whose history you want to import.</p>
                <div><WalletMultiButton /></div>
            </main>
        );
    }
    const wallet = publicKey.toBase58();

    async function scan() {
        if (!signMessage) return setError("This wallet cannot sign messages.");
        setError(null);
        try {
            setStep({ name: "signing-message" });
            const timestamp = Math.floor(Date.now() / 1000);
            const signature = bs58.encode(await signMessage(new TextEncoder().encode(importMessage(wallet, timestamp))));
            setStep({ name: "scanning" });
            setStep({ name: "review", prepared: await prepareImport(wallet, timestamp, signature) });
        } catch (err) {
            setError(explain(err));
            setStep({ name: "start" });
        }
    }

    async function confirm(prepared: PreparedImport) {
        if (!signTransaction) return setError("This wallet cannot sign transactions.");
        setError(null);
        try {
            setStep({ name: "submitting", prepared });
            const tx = await signTransaction(Transaction.from(Buffer.from(prepared.transaction, "base64")));
            const signed = tx.serialize().toString("base64");
            const { signature } = await submitImport(prepared.importId, signed);
            setStep({ name: "done", prepared, signature });
        } catch (err) {
            setError(explain(err));
            setStep({ name: "review", prepared });
        }
    }

    const busy = step.name === "signing-message" || step.name === "scanning" || step.name === "submitting";
    const reached = (n: number) => {
        const order = ["start", "signing-message", "scanning", "review", "submitting", "done"];
        return order.indexOf(step.name) >= n;
    };

    return (
        <main className="tt-page tt-page-narrow">
            <div className="tt-stack" style={{ gap: 8 }}>
                <Link to="/score">Back to score</Link>
                <h1 className="tt-display" style={{ fontSize: 40 }}>Bring your lending history</h1>
                <p className="tt-muted" style={{ fontSize: 15 }}>
                    We read your past loans on {ALL_PROTOCOLS}, price them, and write one imported score to your TrustTrail account.
                    Nothing leaves your wallet except a small network fee.
                </p>
            </div>

            <ol className="tt-stack" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                <StepCard n={1} active={step.name === "start" || step.name === "signing-message"} done={reached(2)} title="Sign a message">
                    Proves this wallet is yours. Free, no transaction. Valid for 7 minutes.
                </StepCard>
                <StepCard n={2} active={step.name === "scanning"} done={reached(3)} title="Check five protocols">
                    {step.name === "scanning"
                        ? `Checking ${ALL_PROTOCOLS}. This can take a minute.`
                        : "Borrows, repays and liquidations from your wallet's history, priced at the time of each loan."}
                </StepCard>
                <StepCard n={3} active={step.name === "review"} done={reached(4)} title="Review what was found">
                    {"prepared" in step ? <Summary prepared={step.prepared} /> : "What was found and the imported score you will get."}
                </StepCard>
                <StepCard n={4} active={step.name === "submitting"} done={step.name === "done"} title="Sign one transaction">
                    {step.name === "done"
                        ? <>Imported. <a href={explorerTx(step.signature)} target="_blank" rel="noreferrer">View the transaction</a>.</>
                        : "Writes the imported score to your account on-chain. The loan list becomes public, so any lender can check it. Next import in 15 days."}
                </StepCard>
            </ol>

            {error && <p className="tt-error" role="alert">{error}</p>}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {step.name === "review" ? (
                    <button className="tt-button-primary" onClick={() => confirm(step.prepared)}>Sign and import</button>
                ) : step.name === "done" ? (
                    <Link to="/score" className="tt-button-primary" style={{ padding: "0 22px", minHeight: 44, borderRadius: 8 }}>See my score</Link>
                ) : (
                    <button className="tt-button-primary" onClick={scan} disabled={busy}>{busy ? "Working…" : "Start"}</button>
                )}
                {step.name !== "done" && <Link to="/score" className="tt-button-secondary">Cancel</Link>}
            </div>
        </main>
    );
}

function StepCard(props: { n: number; title: string; active: boolean; done: boolean; children: ReactNode }) {
    const tone = props.done
        ? { background: "var(--tt-success-bg)", color: "var(--tt-success)", border: "none" }
        : props.active
          ? { background: "var(--tt-accent)", color: "var(--tt-bg)", border: "none" }
          : { background: "none", color: "var(--tt-text-secondary)", border: "1px solid var(--tt-text-muted)" };
    return (
        <li
            className={`tt-card ${props.active ? "tt-card-accent" : ""}`}
            style={{ flexDirection: "row", gap: 16, padding: 20 }}
        >
            <span style={{ flex: "0 0 32px", height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, ...tone }}>
                {props.n}
            </span>
            <div className="tt-stack" style={{ gap: 4, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{props.title}</span>
                <span className="tt-muted">{props.children}</span>
            </div>
        </li>
    );
}

function Summary({ prepared: p }: { prepared: PreparedImport }) {
    return (
        <span className="tt-stack" style={{ gap: 4 }}>
            <span>
                {p.newLoans} new loans to count, {p.pricedLoans} priced, {p.unpricedLoans} without a price (kept in the public list, not scored).
            </span>
            {p.sameTransactionLoans > 0 && <span>{p.sameTransactionLoans} loans opened and repaid in one transaction were skipped.</span>}
            <span>
                Imported score <strong style={{ color: "var(--tt-text)" }}>{p.score}</strong>, {p.meaningfulOnTime} meaningful loans on time.
            </span>
            {p.createsAccount && <span>This also creates your TrustTrail account (one-time rent, about 0.002 SOL).</span>}
        </span>
    );
}
