import { useState } from "react";

export function UpdateScoreButton({ walletAddress, onUpdated }: { walletAddress: string; onUpdated: () => void }) {
    const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");

    async function updateScore() {
        setStatus("pending");
        try {
            const res = await fetch(`http://localhost:3000/update-score/${walletAddress}`, { method: "POST" });
            if (!res.ok) { setStatus("error"); return; }
            setStatus("idle");
            onUpdated();
        } catch (err) {
            console.error("Update failed:", err);
            setStatus("error");
        }
    }

    return (
        <button onClick={updateScore} disabled={status === "pending"}>
            {status === "idle" ? "Record my score on-chain" : status === "pending" ? "Recording..." : "Failed — try again"}
        </button>
    );
}