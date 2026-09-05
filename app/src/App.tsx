import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TrustTrailPath } from "./TrailPath";
import { useUserReputation } from "./useUserReputation";
import { UpdateScoreButton } from "./UpdateScoreButton";
import { UserReputationCard } from "./UserReputationCard";

type ScoreBreakDown = {
    total: number;
    historyScore: number;
    activityScore: number;
    diversityScore: number;
    wealthScore: number;
    repaymentScore: number;
    liquidationScore: number;
};

function App() {
    const { publicKey } = useWallet();
    const { reputation, loading, refetch } = useUserReputation();
    const [score, setScore] = useState<ScoreBreakDown | null>(null);
    const [showDevTools, setShowDevTools] = useState(false);
    const [result, setResult] = useState<string>("");

    async function checkScore() {
        if (!publicKey) {
            setResult("Connect your wallet first");
            return;
        }
        const res = await fetch(`http://localhost:3000/score/${publicKey.toBase58()}`);
        const data = await res.json();
        setScore(data);
    }

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "1.5rem 2rem",
                    borderBottom: "1px solid var(--tt-surface-line)",
                }}
            >
                <span style={{ fontFamily: "var(--tt-font-display)", fontSize: 20, fontWeight: 500 }}>
                    TrustTrail
                </span>
                <WalletMultiButton />
            </div>

            <div style={{ maxWidth: 640, margin: "0 auto", padding: "3rem 1.5rem" }}>
                <p
                    style={{
                        textAlign: "center",
                        fontSize: 13,
                        color: "var(--tt-text-secondary)",
                        marginBottom: "2.5rem",
                    }}
                >
                    On-chain reputation, verified across your history
                </p>

                {!publicKey && (
                    <div style={{ textAlign: "center", padding: "2rem 0" }}>
                        <p
                            style={{
                                fontSize: 15,
                                color: "var(--tt-text-secondary)",
                                lineHeight: 1.7,
                                maxWidth: 480,
                                margin: "0 auto 2rem",
                            }}
                        >
                            Every major Solana lending protocol treats your wallet as an anonymous
                            stranger with zero history — forcing over-collateralization no matter
                            how long you've been using DeFi responsibly. TrustTrail turns your real
                            on-chain behavior into a portable score any protocol can trust.
                        </p>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                gap: 32,
                                flexWrap: "wrap",
                                marginBottom: "2rem",
                            }}
                        >
                            <div>
                                <p style={{ fontFamily: "var(--tt-font-mono)", fontSize: 24, color: "var(--tt-accent)", margin: 0 }}>
                                    35%
                                </p>
                                <p style={{ fontSize: 12, color: "var(--tt-text-muted)", margin: 0 }}>Repayment history</p>
                            </div>
                            <div>
                                <p style={{ fontFamily: "var(--tt-font-mono)", fontSize: 24, color: "var(--tt-accent)", margin: 0 }}>
                                    6
                                </p>
                                <p style={{ fontSize: 12, color: "var(--tt-text-muted)", margin: 0 }}>On-chain factors</p>
                            </div>
                            <div>
                                <p style={{ fontFamily: "var(--tt-font-mono)", fontSize: 24, color: "var(--tt-accent)", margin: 0 }}>
                                    0–1000
                                </p>
                                <p style={{ fontSize: 12, color: "var(--tt-text-muted)", margin: 0 }}>Score range</p>
                            </div>
                        </div>
                        <p style={{ fontSize: 13, color: "var(--tt-text-muted)" }}>
                            Connect your wallet above to see your own score.
                        </p>
                    </div>
                )}

                {publicKey && !score && (
                    <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                        <button onClick={checkScore}>Preview my score</button>
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

                {/* On-chain record — the main thing — shown first */}
                {!loading && reputation && (
                    <div style={{ marginBottom: "1.5rem" }}>
                        <UserReputationCard reputation={reputation} />
                    </div>
                )}

                {/* Live preview trail — shown below the real on-chain record */}
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

                <div style={{ marginTop: "3rem", textAlign: "center" }}>
                    <button
                        onClick={() => setShowDevTools(!showDevTools)}
                        style={{
                            fontSize: 11,
                            color: "var(--tt-text-muted)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                        }}
                    >
                        {showDevTools ? "Hide dev tools" : "Show dev tools"}
                    </button>
                    {showDevTools && (
                        <div style={{ marginTop: 12 }}>
                            <p style={{ fontSize: 12, color: "var(--tt-text-muted)", whiteSpace: "pre-wrap" }}>
                                {result}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;