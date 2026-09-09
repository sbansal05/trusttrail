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

const WEIGHTS_DISPLAY: { label: string; weight: string; fromKamino: boolean }[] = [
    { label: "Repayment", weight: "35%", fromKamino: true },
    { label: "Liquidation", weight: "20%", fromKamino: true },
    { label: "Wealth", weight: "15%", fromKamino: false },
    { label: "History", weight: "10%", fromKamino: false },
    { label: "Activity", weight: "10%", fromKamino: false },
    { label: "Diversity", weight: "10%", fromKamino: false },
];

const TIER_GRADIENTS: Record<string, { gradient: string; textColor: string; subColor: string; paddingY: number }> = {
    Bronze: { gradient: "linear-gradient(135deg, #D6A868, #A5713A)", textColor: "#2A1D0F", subColor: "#4A3520", paddingY: 11 },
    Silver: { gradient: "linear-gradient(135deg, #E4E2DA, #A6A49C)", textColor: "#22201C", subColor: "#4A473F", paddingY: 13 },
    Gold: { gradient: "linear-gradient(135deg, #F0D275, #C79A2E)", textColor: "#2E2205", subColor: "#4A3A0A", paddingY: 15 },
};

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
                        padding: "1.75rem 2.5rem",
                        borderBottom: "1px solid var(--tt-surface-line)",
                        position: "relative",
                    }}
                >
                    <span style={{ fontFamily: "'Fraunces', serif", fontSize: 32, fontWeight: 500 }}>
                        TrustTrail
                    </span>
                    {publicKey && <WalletMultiButton />}
                </div>

                {!publicKey && (
                    <div style={{ position: "relative", maxWidth: 900, margin: "0 auto" }}>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "nowrap",
                                gap: "clamp(16px, 6vw, 110px)",
                                padding: "4rem 2.5rem 2.5rem",
                                alignItems: "center",
                            }}
                        >
                            <div style={{ flex: "0 1 360px", minWidth: 0 }}>
                                <p
                                    style={{
                                        fontFamily: "var(--tt-font-display)",
                                        fontSize: 34,
                                        fontWeight: 500,
                                        color: "var(--tt-text)",
                                        lineHeight: 1.25,
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
                                        margin: "0 0 30px",
                                    }}
                                >
                                    TrustTrail turns your real on-chain behavior into a portable score any protocol can trust.
                                </p>
                                <div style={{ marginBottom: 10 }}>
                                    <WalletMultiButton />
                                </div>
                                <p style={{ fontSize: 12, color: "var(--tt-text-muted)", margin: 0 }}>
                                    Connect your wallet to see your score.
                                </p>
                            </div>

                            {/* marginLeft: "auto" explicitly pins this column flush
                                against the flex row's right edge, guaranteed —
                                independent of exactly how the text column's flex
                                math resolves. Same right edge as the Score
                                Weighting box below, since both share the same
                                2.5rem outer padding from this 900px parent. */}
                            <div
                                style={{
                                    flex: "0 0 auto",
                                    marginLeft: "auto",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "stretch",
                                    gap: 12,
                                }}
                            >
                                {TIERS.map(({ name, range }) => (
                                    <div
                                        key={name}
                                        style={{
                                            background: TIER_GRADIENTS[name].gradient,
                                            borderRadius: 11,
                                            padding: `${TIER_GRADIENTS[name].paddingY}px 22px`,
                                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 10px rgba(0,0,0,0.4)",
                                            width: 130,
                                        }}
                                    >
                                        <p
                                            style={{
                                                fontFamily: "var(--tt-font-display)",
                                                fontSize: 16,
                                                fontWeight: 600,
                                                color: TIER_GRADIENTS[name].textColor,
                                                margin: "0 0 2px",
                                            }}
                                        >
                                            {name}
                                        </p>
                                        <p
                                            style={{
                                                fontSize: 10,
                                                color: TIER_GRADIENTS[name].subColor,
                                                margin: 0,
                                            }}
                                        >
                                            {range}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ padding: "0 2.5rem 3rem" }}>
                            <div style={{ background: "var(--tt-surface)", borderRadius: 16, padding: "1.75rem 1.5rem" }}>
                                <p
                                    style={{
                                        fontSize: 11,
                                        color: "var(--tt-text-muted)",
                                        margin: "0 0 18px",
                                        textTransform: "uppercase",
                                        letterSpacing: 1,
                                        textAlign: "center",
                                    }}
                                >
                                    Score weighting
                                </p>
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(3, 1fr)",
                                        gap: "clamp(8px, 2vw, 16px)",
                                    }}
                                >
                                    {WEIGHTS_DISPLAY.map(({ label, weight, fromKamino }) => (
                                        <div
                                            key={label}
                                            style={{
                                                background: fromKamino ? "#2A241D" : "#241F19",
                                                border: `1px solid ${fromKamino ? "var(--tt-accent)" : "var(--tt-surface-line)"}`,
                                                borderRadius: 14,
                                                padding: "clamp(10px, 2vw, 20px) 6px",
                                                textAlign: "center",
                                                minWidth: 0,
                                            }}
                                        >
                                            <p
                                                style={{
                                                    fontSize: "clamp(9px, 1.6vw, 12px)",
                                                    color: fromKamino ? "var(--tt-text)" : "var(--tt-text-secondary)",
                                                    margin: "0 0 8px",
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                }}
                                            >
                                                {label}
                                            </p>
                                            <p
                                                style={{
                                                    fontFamily: "var(--tt-font-display)",
                                                    fontSize: "clamp(16px, 4vw, 30px)",
                                                    fontWeight: 500,
                                                    color: fromKamino ? "var(--tt-text)" : "var(--tt-text-secondary)",
                                                    margin: 0,
                                                }}
                                            >
                                                {weight}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                                <div
                                    style={{
                                        marginTop: 18,
                                        padding: "12px 14px",
                                        background: "var(--tt-bg)",
                                        borderRadius: 8,
                                        borderLeft: "2px solid var(--tt-accent)",
                                    }}
                                >
                                    <p style={{ fontSize: 15, color: "var(--tt-text-secondary)", margin: 0, lineHeight: 1.5, textAlign: "left" }}>
                                        Repayment and Liquidation are computed directly from real{" "}
                                        <span style={{ color: "var(--tt-accent)", fontWeight: 600 }}>Kamino Lending</span>{" "}
                                        transaction history — not estimated.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div style={{ maxWidth: 640, margin: "0 auto", padding: publicKey ? "3rem 1.5rem" : "0 1.5rem 3rem" }}>
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