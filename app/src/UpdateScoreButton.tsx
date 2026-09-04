import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

const COOLDOWN_MS = 60_000; // 60 seconds between updates

export function UpdateScoreButton({ onUpdated }: { onUpdated: () => void }) {
    const { publicKey, signMessage } = useWallet();
    const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");
    const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(0);

    useEffect(() => {
        if (!cooldownUntil) return;

        const interval = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
            setSecondsLeft(remaining);
            if (remaining === 0) {
                setCooldownUntil(null);
                clearInterval(interval);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [cooldownUntil]);

    async function updateScore() {
        if (!publicKey || !signMessage) return;
        setStatus("pending");
        try {
            const walletAddress = publicKey.toBase58();
            const message = `Update TrustTrail score for wallet: ${walletAddress}`;
            const signatureBytes = await signMessage(new TextEncoder().encode(message));
            const signature = bs58.encode(signatureBytes);

            const res = await fetch(`http://localhost:3000/update-score/${walletAddress}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ signature }),
            });
            if (!res.ok) {
                setStatus("error");
                return;
            }
            setStatus("idle");
            setCooldownUntil(Date.now() + COOLDOWN_MS);
            setSecondsLeft(Math.ceil(COOLDOWN_MS / 1000));
            onUpdated();
        } catch (err) {
            console.error("Update failed:", err);
            setStatus("error");
        }
    }

    const inCooldown = cooldownUntil !== null && secondsLeft > 0;

    return (
        <button
            className="tt-button-primary"
            onClick={updateScore}
            disabled={status === "pending" || inCooldown}
        >
            {status === "pending"
                ? "Recording..."
                : inCooldown
                ? `Updated — wait ${secondsLeft}s`
                : status === "error"
                ? "Failed — try again"
                : "Record my score on-chain"}
        </button>
    );
}