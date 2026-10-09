import { OUTCOMES } from "../format";

export function OutcomePill({ outcome }: { outcome: number }) {
    const o = OUTCOMES.at(outcome);
    if (!o) return <span className="tt-pill">Unknown</span>;
    return <span className={`tt-pill tt-pill-${o.tone}`}>{o.label}</span>;
}
