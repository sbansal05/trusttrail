//! Which protocols the latest confirmed import checked, and what each one contributed.

import type { PublicImport } from "../history/store";

export type ProtocolCoverage = {
    protocol: string;
    loans: number;
    onTime: number;
    late: number;
    liquidated: number;
    defaulted: number;
    unpriced: number;
    usdMicro: string;   // Σ peak debt of the priced loans
};

export type Coverage = {
    importId: string | null;
    importedAt: number | null;   // cluster time the import was computed at
    nextImportAt: number | null; // from the on-chain import date + cooldown
    protocols: ProtocolCoverage[];
};

const OUTCOME_KEYS = ["onTime", "late", "liquidated", "defaulted"] as const;

export function coverageOf(latest: PublicImport | undefined, nextImportAt: number | null): Coverage {
    if (!latest) return { importId: null, importedAt: null, nextImportAt, protocols: [] };
    const protocols = latest.checkedProtocols.map((protocol): ProtocolCoverage => {
        const c: ProtocolCoverage = { protocol, loans: 0, onTime: 0, late: 0, liquidated: 0, defaulted: 0, unpriced: 0, usdMicro: "0" };
        let usd = 0n;
        for (const l of latest.loans) {
            if (l.protocol !== protocol) continue;
            c.loans += 1;
            c[OUTCOME_KEYS[l.outcome]] += 1;
            if (l.usdMicro === null) c.unpriced += 1;
            else usd += BigInt(l.usdMicro);
        }
        c.usdMicro = usd.toString();
        return c;
    });
    return { importId: latest.id, importedAt: latest.computedAt, nextImportAt, protocols };
}
