import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TrustTrailPath } from "./TrailPath";
import { useUserReputation } from "./useUserReputation";
import { VerifyButton } from "./VerifyButton";
import { UserReputationCard } from "./UserReputationCard";

type ScoreBreakDown = {
    total: number;
    historyScore: number;
    activityScore: number;
    identityScore: number;
    wealthScore: number;
    humanityScore: number;
    diversityScore: number;
};

function App() {
    const { publicKey } = useWallet();
    const { reputation, loading, refetch } = useUserReputation();
    const [score, setScore] = useState<ScoreBreakDown | null>(null);
    const [showDevTools, setShowDevTools] = useState(false);
    const [result, setResult] = useState<string>("");

    async function testBackend() {
        if (!publicKey) {
            setResult("Connect your wallet first");
            return;
        }
        const res = await fetch("http://localhost:3000/verify-and-score", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ walletAddress: publicKey.toBase58(), proof: { fake: true } }),
        });
        const data = await res.json();
        setResult(JSON.stringify(data, null, 2));
    }

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
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "3rem 1.5rem" }}>
            <header style={{ textAlign: "center", marginBottom: "2.5rem" }}>
                <h1
                    style={{
                        fontFamily: "var(--tt-font-display)",
                        fontWeight: 500,
                        fontSize: 32,
                        margin: "0 0 6px",
                        letterSpacing: 0.5,
                    }}
                >
                    TrustTrail
                </h1>
                <p style={{ fontSize: 13, color: "var(--tt-text-secondary)", margin: "0 0 20px" }}>
                    On-chain reputation, verified across your history
                </p>
                <WalletMultiButton />
            </header>

            {publicKey && score && <TrustTrailPath score={score} />}

            {publicKey && !score && (
                <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
                    <button onClick={checkScore}>Check my score</button>
                </div>
            )}

            {loading && (
                <p style={{ textAlign: "center", color: "var(--tt-text-secondary)" }}>Loading on-chain reputation...</p>
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
                    <VerifyButton walletAddress={publicKey.toBase58()} onVerified={refetch} />
                </div>
            )}

            <div style={{ marginTop: "3rem", textAlign: "center" }}>
                <button
                    onClick={() => setShowDevTools(!showDevTools)}
                    style={{ fontSize: 11, color: "var(--tt-text-muted)", background: "none", border: "none", cursor: "pointer" }}
                >
                    {showDevTools ? "Hide dev tools" : "Show dev tools"}
                </button>
                {showDevTools && (
                    <div style={{ marginTop: 12 }}>
                        <button onClick={testBackend}>Test backend (fake proof)</button>
                        <p style={{ fontSize: 12, color: "var(--tt-text-muted)", whiteSpace: "pre-wrap" }}>{result}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;