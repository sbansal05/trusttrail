import { useState, useEffect, useRef } from "react";

const CHECK_INTERVAL_MS = 60_000; // check once a minute

// Detects a new deployment by re-fetching the page's own HTML periodically
// and comparing it to what was loaded at start. Vite gives every build's
// script tags a new content hash, so the HTML genuinely changes on a real
// new deployment — this doesn't rely on any custom build step.
export function useUpdateChecker(): boolean {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const initialHtmlRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function checkForUpdate() {
            try {
                const res = await fetch("/", { cache: "no-store" });
                const html = await res.text();

                if (initialHtmlRef.current === null) {
                    initialHtmlRef.current = html;
                    return;
                }

                if (!cancelled && html !== initialHtmlRef.current) {
                    setUpdateAvailable(true);
                }
            } catch (err) {
                console.error("Update check failed:", err);
            }
        }

        checkForUpdate();
        const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    return updateAvailable;
}