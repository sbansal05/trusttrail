import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> = { data: T | null; error: Error | null; loading: boolean; reload: () => void };

/**
 * Runs `load` when `key` changes, and again on reload(). A null key means "nothing to load yet".
 * A reload keeps showing the old data until the new answer arrives; a new key clears it.
 * An answer that arrives after a newer request started is dropped.
 */
export function useAsync<T>(key: string | null, load: (key: string) => Promise<T>): AsyncState<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [loading, setLoading] = useState(false);
    const [round, setRound] = useState(0);
    const shownKey = useRef<string | null>(null);
    const reload = useCallback(() => setRound((r) => r + 1), []);

    useEffect(() => {
        let current = true;
        /* eslint-disable react-hooks/set-state-in-effect -- the request starts here, its result lands below */
        if (shownKey.current !== key) {
            shownKey.current = key;
            setData(null);
        }
        setError(null);
        setLoading(key !== null);
        /* eslint-enable react-hooks/set-state-in-effect */
        if (key === null) return;
        load(key)
            .then((d) => current && setData(d))
            .catch((e: unknown) => current && setError(e instanceof Error ? e : new Error(String(e))))
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
        // `load` is a module-level function in every caller; only the key and reloads matter.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, round]);

    return { data, error, loading, reload };
}
