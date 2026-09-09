import { useEffect, useRef } from "react";

const CHECK_INTERVAL_MS = 60_000; // check once a minute


export function useUpdateChecker(): void {
    const initialHtmlRef = useRef<string | null>(null);

    useEffect(() => {
        async function checkForUpdate() {
            try {
                const res = await fetch("/", { cache: "no-store" });
                const html = await res.text();

                if (initialHtmlRef.current === null) {
                    initialHtmlRef.current = html;
                    return;
                }

                if (html !== initialHtmlRef.current) {
                    window.location.reload();
                }
            } catch (err) {
                console.error("Update check failed:", err);
            }
        }

        checkForUpdate();
        const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);

        return () => clearInterval(interval);
    }, []);
}