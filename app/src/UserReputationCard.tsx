import BN from "bn.js";
import { GuillocheBackground } from "./GuillocheBackground";

type UserReputation = {
    score: number;
    last_update: number;
    claims_bitmask: BN;
    flags: number;
    bump: number;
};

function getTier(score: number): string {
    if (score >= 750) return "Gold";
    if (score >= 500) return "Silver";
    return "Bronze";
}

export function UserReputationCard({ reputation }: { reputation: UserReputation }) {
    const tier = getTier(reputation.score);

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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
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
                        <p style={{ fontFamily: "var(--tt-font-display)", fontSize: 34, color: "var(--tt-text)", margin: 0, fontWeight: 500 }}>
                            {reputation.score}
                        </p>
                    </div>
                    <span
                        style={{
                            fontFamily: "var(--tt-font-mono)",
                            fontSize: 12,
                            color: "var(--tt-accent)",
                            border: "1px solid var(--tt-accent)",
                            borderRadius: 4,
                            padding: "4px 12px",
                        }}
                    >
                        {tier} tier
                    </span>
                </div>

            </div>
        </div>
    );
}