import BN from "bn.js";


const BIT_DEFS: { bit: number; label: string }[] = [
    { bit: 0, label: "Wallet age > 1yr" },
    { bit: 1, label: "Consistent activity" },
    { bit: 2, label: "Twitter verified" },
    { bit: 3, label: "Active staker" },
    { bit: 4, label: "Amazon verified" },
    { bit: 5, label: "Uber verified" },
];

export function BitmaskGrid({ claimsBitmask }: { claimsBitmask: BN }) {
    const cells = Array.from({ length: 64 }, (_, i) => i);
    const assignedMap = new Map(BIT_DEFS.map((d) => [d.bit, d]));

    function isLit(bit: number): boolean {
        return claimsBitmask.and(new BN(1).shln(bit)).gtn(0);
    }

    return (
        <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 1fr)", gap: 5, marginBottom: 14 }}>
                {cells.map((bit) => {
                    const def = assignedMap.get(bit);
                    const lit = def ? isLit(bit) : false;
                    return (
                        <div
                            key={bit}
                            title={def ? `bit ${bit} — ${def.label}` : `bit ${bit} — reserved`}
                            style={{
                                aspectRatio: "1",
                                borderRadius: 3,
                                background: lit ? "var(--tt-accent)" : "var(--tt-surface-line)",
                                opacity: def ? (lit ? 1 : 0.5) : 0.15,
                            }}
                        />
                    );
                })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px 16px" }}>
                {BIT_DEFS.map(({ bit, label }) => (
                    <div key={bit} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--tt-text-secondary)" }}>
                        <span style={{ fontFamily: "var(--tt-font-mono)", fontSize: 10, color: "var(--tt-text-muted)", width: 16 }}>
                            b{bit}
                        </span>
                        <span
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: 2,
                                background: isLit(bit) ? "var(--tt-accent)" : "var(--tt-surface-line)",
                            }}
                        />
                        <span>{label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}