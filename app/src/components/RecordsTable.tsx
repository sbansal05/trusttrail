import type { RepaymentRecord } from "../api";
import { explorerAddress } from "../config";
import { TIER_LABELS, day, pctBps, shortAddress, units6 } from "../format";
import { OutcomePill } from "./OutcomePill";

/** The wallet's native repayment records (SAS attestations), newest first. */
export function RecordsTable({ records }: { records: RepaymentRecord[] }) {
    if (records.length === 0) {
        return <p className="tt-muted">No TrustTrail pool loans yet. The first repaid loan writes the first record.</p>;
    }
    const rows = [...records].sort((a, b) => b.closedAt - a.closedAt);
    return (
        <div className="tt-table-wrap">
            <table className="tt-table">
                <thead>
                    <tr>
                        <th>Opened</th>
                        <th>Closed</th>
                        <th>Principal</th>
                        <th>Interest paid</th>
                        <th>Outcome</th>
                        <th>Collateral</th>
                        <th>Tier at open</th>
                        <th>Record</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.address}>
                            <td>{day(r.openedAt)}</td>
                            <td>{day(r.closedAt)}</td>
                            <td className="tt-mono">{units6(r.principalUsdc)} tUSDC</td>
                            <td className="tt-mono">{units6(r.interestPaidUsdc, 6)}</td>
                            <td><OutcomePill outcome={r.outcome} /></td>
                            <td className="tt-mono">{pctBps(r.collateralRatioBps, 0)}</td>
                            <td>{TIER_LABELS.at(r.tierAtOpen) ?? r.tierAtOpen}</td>
                            <td className="tt-mono">
                                <a href={explorerAddress(r.address)} target="_blank" rel="noreferrer">{shortAddress(r.address)}</a>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
