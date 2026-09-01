type ScoreBreakDown = {
  total: number;
  historyScore: number;
  activityScore: number;
  identityScore: number;
  wealthScore: number;
  humanityScore: number;
  diversityScore: number;
};

const STOPS: { key: keyof ScoreBreakDown; label: string }[] = [
  { key: "historyScore", label: "History" },
  { key: "activityScore", label: "Activity" },
  { key: "diversityScore", label: "Diversity" },
  { key: "wealthScore", label: "Wealth" },
  { key: "identityScore", label: "Identity" },
  { key: "humanityScore", label: "Humanity" },
];

export function TrustTrailPath({ score }: { score: ScoreBreakDown }) {
  // How far along the path is filled, based on overall trust score out of 1000.
  const fillPercent = Math.min(score.total / 10, 100);

  return (
    <div style={{ position: "relative", padding: "0 20px", margin: "0 0 2.5rem" }}>
      <div
        style={{
          position: "absolute",
          top: 22,
          left: 40,
          right: 40,
          height: 2,
          background: "var(--tt-surface-line)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 22,
          left: 40,
          width: `calc(${fillPercent}% - 40px)`,
          height: 2,
          background: "var(--tt-accent)",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
        {STOPS.map(({ key, label }) => {
          const value = Math.round(score[key]);
          const reached = value > 0;
          return (
            <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 80 }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  marginBottom: 10,
                  background: reached ? "var(--tt-accent)" : "var(--tt-surface-line)",
                  border: reached ? "none" : "2px solid var(--tt-surface-line)",
                }}
              />
              <p style={{ fontSize: 11, color: "var(--tt-text-secondary)", margin: "0 0 2px", textAlign: "center" }}>
                {label}
              </p>
              <p
                style={{
                  fontFamily: "var(--tt-font-mono)",
                  fontSize: 15,
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
  );
}