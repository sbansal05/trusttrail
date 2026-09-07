import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TrustTrailPath } from "./TrailPath";
import { useUserReputation } from "./useUserReputation";
import { UpdateScoreButton } from "./UpdateScoreButton";
import { UserReputationCard } from "./UserReputationCard";
import { GuillocheBackground } from "./GuillocheBackground";

type ScoreBreakDown = {
    total: number;
    historyScore: number;
    activityScore: number;
    diversityScore: number;
    wealthScore: number;
    repaymentScore: number;
    liquidationScore: number;
};

const EXAMPLE_BREAKDOWN: { label: string; value: number }[] = [
    { label: "History", value: 613 },
    { label: "Activity", value: 1000 },
    { label: "Diversity", value: 600 },
    { label: "Wealth", value: 1000 },
    { label: "Repay", value: 750 },
    { label: "Liquid.", value: 900 },
];

const TIERS: { name: string; range: string }[] = [
    { name: "Bronze", range: "0–499" },
    { name: "Silver", range: "500–749" },
    { name: "Gold", range: "750–1000" },
];

function App() {
    const { publicKey } = useWallet();
    const { reputation, loading, refetch } = useUserReputation();
    const [score, setScore] = useState<ScoreBreakDown | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    async function checkScore() {
        if (!publicKey) return;
        setPreviewLoading(true);
        try {
            const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
            const res = await fetch(`${BACKEND_URL}/score/${publicKey.toBase58()}`);
            const data = await res.json();
            setScore(data);
        } catch (err) {
            console.error("Preview failed:", err);
        } finally {
            setPreviewLoading(false);
        }
    }

    return (
        <>
            {!publicKey && (
                <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
                    <GuillocheBackground />
                </div>
            )}

            <div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "1.75rem 2rem",
                        borderBottom: "1px solid var(--tt-surface-line)",
                    }}
                >
                    <span style={{ fontFamily: "'Fraunces', serif", fontSize: 32, fontWeight: 500 }}>
                        TrustTrail
                    </span>
                    {publicKey && <WalletMultiButton />}
                </div>

                <div style={{ maxWidth: 640, margin: "0 auto", padding: "3rem 1.5rem" }}>
                    {!publicKey && (
                        <div style={{ padding: "1rem 0 2rem" }}>
                            <div style={{ textAlign: "center", maxWidth: 480, margin: "0 auto" }}>
                                <p
                                    style={{
                                        fontFamily: "var(--tt-font-display)",
                                        fontSize: 30,
                                        fontWeight: 500,
                                        color: "var(--tt-text)",
                                        margin: "0 0 18px",
                                    }}
                                >
                                    On-chain reputation, verified across your history
                                </p>

                                <p
                                    style={{
                                        fontSize: 15,
                                        color: "var(--tt-text-secondary)",
                                        lineHeight: 1.6,
                                        margin: "0 0 28px",
                                    }}
                                >
                                    TrustTrail turns your real on-chain behavior into a portable score any protocol can trust.
                                </p>

                                <div style={{ marginBottom: "0.75rem" }}>
                                    <WalletMultiButton />
                                </div>
                                <p style={{ fontSize: 12, color: "var(--tt-text-muted)", marginBottom: "2rem" }}>
                                    Connect your wallet to see your score.
                                </p>

                                <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: "2rem" }}>
                                    {TIERS.map(({ name, range }) => (
                                        <div
                                            key={name}
                                            style={{
                                                border: "1px solid var(--tt-accent)",
                                                borderRadius: 8,
                                                padding: "8px 16px",
                                            }}
                                        >
                                            <p
                                                style={{
                                                    fontFamily: "var(--tt-font-mono)",
                                                    fontSize: 11,
                                                    color: "var(--tt-accent)",
                                                    margin: "0 0 2px",
                                                }}
                                            >
                                                {name}
                                            </p>
                                            <p style={{ fontSize: 10, color: "var(--tt-text-secondary)", margin: 0 }}>
                                                {range}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div
                                style={{
                                    background: "var(--tt-surface)",
                                    borderRadius: 14,
                                    padding: "1.25rem 1rem",
                                    maxWidth: 480,
                                    margin: "0 auto",
                                }}
                            >
                                <p
                                    style={{
                                        fontSize: 10,
                                        color: "var(--tt-text-muted)",
                                        margin: "0 0 12px",
                                        textTransform: "uppercase",
                                        letterSpacing: 1,
                                        textAlign: "center",
                                    }}
                                >
                                    Example breakdown
                                </p>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    {EXAMPLE_BREAKDOWN.map(({ label, value }) => (
                                        <div key={label} style={{ textAlign: "center", width: 70 }}>
                                            <div
                                                style={{
                                                    width: 14,
                                                    height: 14,
                                                    borderRadius: "50%",
                                                    background: "var(--tt-accent)",
                                                    margin: "0 auto 6px",
                                                }}
                                            />
                                            <p style={{ fontSize: 10, color: "var(--tt-text-secondary)", margin: "0 0 2px" }}>
                                                {label}
                                            </p>
                                            <p
                                                style={{
                                                    fontFamily: "var(--tt-font-mono)",
                                                    fontSize: 12,
                                                    color: "var(--tt-text-muted)",
                                                    margin: 0,
                                                }}
                                            >
                                                {value}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {publicKey && !score && (
                        <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                            <button onClick={checkScore} disabled={previewLoading}>
                                {previewLoading ? "Loading..." : "Preview my score"}
                            </button>
                        </div>
                    )}

                    {loading && (
                        <p style={{ textAlign: "center", color: "var(--tt-text-secondary)" }}>
                            Loading on-chain reputation...
                        </p>
                    )}

                    {!loading && publicKey && !reputation && (
                        <p style={{ textAlign: "center", color: "var(--tt-text-secondary)" }}>
                            Not yet verified — no on-chain reputation found for this wallet.
                        </p>
                    )}

                    {!loading && reputation && (
                        <div style={{ marginBottom: "1.5rem" }}>
                            <UserReputationCard reputation={reputation} />
                        </div>
                    )}

                    {publicKey && score && (
                        <>
                            <div style={{ marginBottom: "0.75rem" }}>
                                <TrustTrailPath score={score} />
                            </div>
                            <p
                                style={{
                                    textAlign: "center",
                                    fontSize: 12,
                                    color: "var(--tt-text-muted)",
                                    marginBottom: "2rem",
                                }}
                            >
                                Live preview — nothing is saved until you record it on-chain below.
                            </p>
                        </>
                    )}

                    {publicKey && (
                        <div style={{ textAlign: "center" }}>
                            <UpdateScoreButton onUpdated={refetch} />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

export default App;