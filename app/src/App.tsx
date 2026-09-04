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


                {publicKey && !score && (
                    <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                        <button onClick={checkScore}>Preview my score</button>
                    </div>
                )}
                {publicKey && score && (
                    <>
                        <TrustTrailPath score={score} />
                        <p style={{ textAlign: "center", fontSize: 12, color: "var(--tt-text-muted)", marginTop: -16, marginBottom: "2rem" }}>
                            Live preview — nothing is saved until you record it on-chain below.
                        </p>
                    </>
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