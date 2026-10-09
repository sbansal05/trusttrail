import type { ReactNode } from "react";
import type { RepaymentRecord } from "../api";
import { explorerAddress } from "../config";
import { TIER_LABELS, day, pctBps, shortAddress, units6 } from "../format";
import { OutcomePill } from "./OutcomePill";

type Column = { header: string; compact: boolean; mono?: boolean; cell: (r: RepaymentRecord) => ReactNode };

/** Every column of a record, in order; `compact` marks the ones a narrow card keeps. */
const COLUMNS: Column[] = [
    { header: "Opened", compact: false, cell: (r) => day(r.openedAt) },
    { header: "Closed", compact: true, cell: (r) => day(r.closedAt) },
    { header: "Principal", compact: true, mono: true, cell: (r) => `${units6(r.principalUsdc)} tUSDC` },
    { header: "Interest paid", compact: false, mono: true, cell: (r) => units6(r.interestPaidUsdc, 6) },
    { header: "Outcome", compact: true, cell: (r) => <OutcomePill outcome={r.outcome} /> },
    { header: "Collateral", compact: false, mono: true, cell: (r) => pctBps(r.collateralRatioBps, 0) },
    { header: "Tier at open", compact: false, cell: (r) => TIER_LABELS.at(r.tierAtOpen) ?? r.tierAtOpen },
    {
        header: "Record", compact: true, mono: true,
        cell: (r) => <a href={explorerAddress(r.address)} target="_blank" rel="noreferrer">{shortAddress(r.address)}</a>,
    },
];

/** The wallet's native repayment records (SAS attestations), newest first. `compact` keeps only the key columns. */
export function RecordsTable({ records, compact = false }: { records: RepaymentRecord[]; compact?: boolean }) {
    if (records.length === 0) {
        return <p className="tt-muted">No TrustTrail pool loans yet. The first repaid loan writes the first record.</p>;
    }
    const rows = [...records].sort((a, b) => b.closedAt - a.closedAt);
    const columns = compact ? COLUMNS.filter((c) => c.compact) : COLUMNS;
    return (
        <div className="tt-table-wrap">
            <table className="tt-table">
                <thead>
                    <tr>{columns.map((c) => <th key={c.header}>{c.header}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.address}>
                            {columns.map((c) => <td key={c.header} className={c.mono ? "tt-mono" : undefined}>{c.cell(r)}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}