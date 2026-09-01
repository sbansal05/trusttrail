import { useState } from "react";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";

const APP_ID = import.meta.env.VITE_RECLAIM_APP_ID;
const APP_SECRET = import.meta.env.VITE_RECLAIM_APP_SECRET;

// TODO: replace with a real, actively-maintained provider ID once Reclaim
// support responds — the current one was confirmed dead (stale target URL).
const PROVIDER_ID = "955cd7f6-0931-41ec-a681-1c1c11d6a2ba";

export function VerifyButton({ walletAddress, onVerified }: { walletAddress: string; onVerified: () => void }) {
    const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");
    const [requestUrl, setRequestUrl] = useState<string | null>(null);

    async function startVerification() {
        setStatus("pending");
        try {
            const proofRequest = await ReclaimProofRequest.init(APP_ID, APP_SECRET, PROVIDER_ID, {
                acceptTeeAttestation: false,
            });

            const url = await proofRequest.getRequestUrl();
            setRequestUrl(url);

            await proofRequest.startSession({
                onSuccess: async (proof) => {
                    const res = await fetch("http://localhost:3000/verify-and-score", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ walletAddress, proof }),
                    });

                    if (!res.ok) {
                        console.error("Backend rejected proof:", await res.text());
                        setStatus("error");
                        return;
                    }

                    setStatus("idle");
                    setRequestUrl(null);
                    onVerified();
                },
                onError: (err) => {
                    console.error("Verification failed:", err);
                    setStatus("error");
                },
            });
        } catch (err) {
            console.error("Init failed:", err);
            setStatus("error");
        }
    }

    const borderStyle = status === "error" ? "solid" : "dashed";
    const borderColor = status === "error" ? "var(--tt-text-muted)" : "var(--tt-surface-line)";

    return (
        <div style={{ display: "inline-block", textAlign: "left" }}>
            <button
                onClick={startVerification}
                disabled={status === "pending"}
                style={{
                    borderStyle,
                    borderColor,
                    borderWidth: 1,
                    background: "var(--tt-surface)",
                    borderRadius: 12,
                    padding: "16px 20px",
                    textAlign: "left",
                    minWidth: 160,
                }}
            >
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, color: "var(--tt-text)" }}>Amazon</div>
                <div style={{ fontSize: 11, color: "var(--tt-text-secondary)" }}>
                    {status === "idle" && "Tap to verify"}
                    {status === "pending" && "Verifying..."}
                    {status === "error" && "Failed — try again"}
                </div>
            </button>
            {requestUrl && (
                <p style={{ marginTop: 8, textAlign: "center" }}>
                    <a href={requestUrl} target="_blank" rel="noreferrer" style={{ color: "var(--tt-accent)", fontSize: 12 }}>
                        Open verification link
                    </a>
                </p>
            )}
        </div>
    );
}