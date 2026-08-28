import { useState  } from "react";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";

const APP_ID = import.meta.env.VITE_RECLAIM_APP_ID;
const APP_SECRET = import.meta.env.VITE_RECLAIM_APP_SECRET;

const PROVIDER_ID = "955cd7f6-0931-41ec-a681-1c1c11d6a2ba";

export function VerifyButton({ walletAddress, onVerified }: {walletAddress: string; onVerified: () => void}) {
    const [status, setStatus] = useState<"idle"| "pending" | "error">("idle");
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
                        headers: { "Content-Type": "application/json"},
                        body: JSON.stringify({
                            walletAddress: walletAddress,
                            proof: proof
                        })
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
            setStatus('error');
        }
    }

    return (
        <div>
            <button onClick={startVerification} disabled={status === "pending"}>
                {status === "idle" ? "Verify Amazon" : status === "pending" ? "Verifying..." : "Try Again"}
            </button>
            {requestUrl && (
                <p>
                    <a href={requestUrl} target="_blank" rel="noreferrer">
                        Open Verification Link
                    </a>
                </p>
            )}
        </div>
    );
}

