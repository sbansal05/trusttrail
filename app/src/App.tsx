import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ScoreCard  } from "./ScoreCard";
import { useUserReputation } from "./useUserReputation";
import { VerifyButton } from "./VerifyButton";
type ScoreBreakDown = {
  total: number;
  historyScore: number;
  activityScore: number;
  identityScore: number;
  wealthScore: number;
  humanityScore: number;
  diversityScore: number;
};

function App() {
  const { publicKey } = useWallet();
  const [result, setResult] = useState<string>("");
  const { reputation, loading, refetch } = useUserReputation();
  const [score, setScore] = useState<ScoreBreakDown | null>(null);
  async function testBackend() {
    if (!publicKey) {
      setResult("Connect your wallet first");
      return;
    }
    const res = await fetch("http://localhost:3000/verify-and-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        walletAddress: publicKey.toBase58(), 
        proof: { fake: true } }),
    });
    const data = await res.json();
    setResult(JSON.stringify(data, null, 2));
  }
  async function checkScore() {
    if (!publicKey) {
      setResult("Connect your wallet first");
      return;
    }
    const res = await fetch(`http://localhost:3000/score/${publicKey.toBase58()}`);
    const data = await res.json();
    setScore(data);

  }

  return (
    <div>
      <button onClick={testBackend}>Test Backend</button>
      <WalletMultiButton></WalletMultiButton>
      <button onClick={checkScore}>Check my Score</button>
      <p>{result}</p>
      {loading && <p>Loading on-chain reputation...</p>}

      {!loading && publicKey && !reputation && (
        <p>Not yet yet verified - no on-chain reputation found for this wallet.</p>
      )}
      {!loading && reputation && (
        <p>On-chain score: {reputation.score}</p>
      )}
      {score && publicKey && <ScoreCard score={score} walletAddress={publicKey.toBase58()} />}
      {publicKey && (
        <VerifyButton walletAddress={publicKey.toBase58()} onVerified={refetch} />
      )}
    </div>
  );
}

export default App;