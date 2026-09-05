type ScoreBreakDown = {
  total: number;
  historyScore: number;
  activityScore: number;
  diversityScore: number;
  wealthScore: number;
  repaymentScore: number;
  liquidationScore: number;
};

const STOPS: { key: keyof ScoreBreakDown; label: string }[] = [
  { key: "historyScore", label: "History" },
  { key: "activityScore", label: "Activity" },
  { key: "diversityScore", label: "Diversity" },
  { key: "wealthScore", label: "Wealth" },
  { key: "repaymentScore", label: "Repayment" },
  { key: "liquidationScore", label: "Liquidation" },
];

export function TrustTrailPath({ score }: { score: ScoreBreakDown }) {
  // How far along the path is filled, based on overall trust score out of 1000.
  const fillPercent = Math.min(score.total / 10, 100);

  return (
    <div style={{ background: "var(--tt-surface)", borderRadius: 16, padding: "2rem 1.5rem" }}>
      <p
        style={{
          fontSize: 13,
          color: "var(--tt-text-secondary)",
          margin: "0 0 1.5rem",
          textTransform: "uppercase",
          letterSpacing: 1.5,
          textAlign: "center",
        }}
      >
        Score breakdown
      </p>

      <div style={{ position: "relative", padding: "0 30px" }}>
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 50,
            right: 50,
            height: 3,
            background: "var(--tt-surface-line)",
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 50,
            width: `calc(${fillPercent}% - 50px)`,
            height: 3,
            background: "var(--tt-accent)",
            borderRadius: 2,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
          {STOPS.map(({ key, label }) => {
            const value = Math.round(score[key]);
            const reached = value > 0;
            return (
              <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 100 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    marginBottom: 16,
                    background: reached ? "var(--tt-accent)" : "var(--tt-surface-line)",
                    border: reached ? "none" : "2px solid var(--tt-surface-line)",
                  }}
                />
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--tt-text-secondary)",
                    margin: "0 0 4px",
                    textAlign: "center",
                  }}
                >
                  {label}
                </p>
                <p
                  style={{
                    fontFamily: "var(--tt-font-mono)",
                    fontSize: 22,
                    fontWeight: 500,
                    color: reached ? "var(--tt-text)" : "var(--tt-text-muted)",
                    margin: 0,
                  }}
                >
                  {value}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}