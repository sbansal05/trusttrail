import BN from "bn.js";
import { GuillocheBackground } from "./GuillocheBackground";

type UserReputation = {
    score: number;
    last_update: number;
    claims_bitmask: BN;
    flags: number;
    bump: number;
};

function getTier(score: number): "Bronze" | "Silver" | "Gold" {
    if (score >= 750) return "Gold";
    if (score >= 500) return "Silver";
    return "Bronze";
}

// Each tier gets its own real metallic gradient rather than sharing a single
// accent color — dark, ink-toned text sits on top since all three gradients
// are light/mid-tone, matching the landing page's tier badges for a
// consistent "medal" language across the whole app.
const TIER_STYLES: Record<string, { gradient: string; textColor: string }> = {
    Bronze: { gradient: "linear-gradient(135deg, #D6A868, #A5713A)", textColor: "#2A1D0F" },
    Silver: { gradient: "linear-gradient(135deg, #E4E2DA, #A6A49C)", textColor: "#22201C" },
    Gold: { gradient: "linear-gradient(135deg, #F0D275, #C79A2E)", textColor: "#2E2205" },
};

export function UserReputationCard({ reputation }: { reputation: UserReputation }) {
    const tier = getTier(reputation.score);
    const tierStyle = TIER_STYLES[tier];

    return (
        <div
            style={{
                position: "relative",
                overflow: "hidden",
                background: "var(--tt-surface)",
                borderRadius: 12,
                borderLeft: "3px solid var(--tt-accent)",
                padding: "1.5rem",
            }}
        >
            <GuillocheBackground />

            <div style={{ position: "relative" }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 20,
                    }}
                >
                    <div>
                        <p
                            style={{
                                fontSize: 12,
                                color: "var(--tt-text-secondary)",
                                margin: "0 0 4px",
                                textTransform: "uppercase",
                                letterSpacing: 1,
                            }}
                        >
                            On-chain record
                        </p>
                        <p
                            style={{
                                fontFamily: "var(--tt-font-display)",
                                fontSize: 34,
                                color: "var(--tt-text)",
                                margin: 0,
                                fontWeight: 500,
                            }}
                        >
                            {reputation.score}
                        </p>
                    </div>
                    <span
                        style={{
                            fontFamily: "var(--tt-font-display)",
                            fontSize: 14,
                            fontWeight: 600,
                            color: tierStyle.textColor,
                            background: tierStyle.gradient,
                            borderRadius: 5,
                            padding: "6px 18px",
                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 2px 4px rgba(0,0,0,0.3)",
                        }}
                    >
                        {tier} tier
                    </span>
                </div>
            </div>
        </div>
    );
}