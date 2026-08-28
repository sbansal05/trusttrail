type ScoreBreakDown = {
  total: number;
  historyScore: number;
  activityScore: number;
  identityScore: number;
  wealthScore: number;
  humanityScore: number;
  diversityScore: number;
};

const METRICS: { key: keyof ScoreBreakDown; label: string; verifiable?: boolean }[] = [
  { key: "historyScore", label: "History" },
  { key: "activityScore", label: "Activity" },
  { key: "diversityScore", label: "Diversity" },
  { key: "wealthScore", label: "Wealth" },
  { key: "identityScore", label: "Identity", verifiable: true },
  { key: "humanityScore", label: "Humanity", verifiable: true },
];

export function ScoreCard({ score, walletAddress }: { score: ScoreBreakDown; walletAddress: string }) {
  const short = `${walletAddress.slice(0, 4)}..${walletAddress.slice(-4)}`;

  return (
    <div style={{ background: "#1c1c1e", borderRadius: 12, border: "1px solid #333", padding: 24, maxWidth: 560 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
        <div>
          <p style={{ fontSize: 13, color: "#999", margin: "0 0 4px" }}>Trust score</p>
          <p style={{ fontSize: 36, fontWeight: 500, margin: 0, color: "#fff" }}>{Math.round(score.total)}</p>
        </div>
        <p style={{ fontSize: 13, color: "#666", fontFamily: "monospace", margin: 0 }}>{short}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {METRICS.map(({ key, label, verifiable }) => {
          const value = Math.round(score[key]);
          const unverified = verifiable && value === 0;

          return (
            <div key={key} style={{ background: "#252527", borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#999" }}>{label}</span>
                {unverified && (
                  <span style={{ fontSize: 11, color: "#666", background: "#1c1c1e", padding: "2px 8px", borderRadius: 6 }}>
                    Unverified
                  </span>
                )}
              </div>
              <p style={{ fontSize: 20, fontWeight: 500, margin: "0 0 8px", color: unverified ? "#666" : "#fff" }}>
                {value}
              </p>
              <div style={{ height: 4, background: "#333", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${value / 10}%`, background: "#5b8def" }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}