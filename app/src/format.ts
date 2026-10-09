//! Display helpers shared by every screen.

export const TIER_LABELS = ["Unproven", "Bronze", "Silver", "Gold"];
export const tierLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export const PROTOCOL_LABELS: Record<string, string> = {
    kamino: "Kamino",
    marginfi: "MarginFi",
    save: "Save",
    jupiter_lend: "Jupiter Lend",
    loopscale: "Loopscale",
};
/** The protocols every import checks, in the order the screens list them. */
export const PROTOCOLS = Object.keys(PROTOCOL_LABELS);

export const OUTCOMES = [
    { label: "On time", tone: "good" },
    { label: "Late", tone: "warn" },
    { label: "Liquidated", tone: "bad" },
    { label: "Defaulted", tone: "bad" },
] as const;

/** 6-decimal token amount (micro units, as a decimal string) → "1,234.56". */
export function units6(micro: string | bigint, digits = 2): string {
    const n = Number(BigInt(micro)) / 1e6;
    return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const usd6 = (micro: string | bigint) => `$${units6(micro)}`;
export const pctBps = (bps: string | number, digits = 1) => `${(Number(bps) / 100).toFixed(digits)}%`;
export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Unix seconds → "Oct 8, 2026"; 0 or null → "—". */
export function day(secs: number | null): string {
    if (!secs) return "—";
    return new Date(secs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
