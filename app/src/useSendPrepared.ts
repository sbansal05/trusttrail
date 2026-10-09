import { useCallback } from "react";
import { Buffer } from "buffer";
import { VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

/**
 * Signs transactions the backend prepared (one wallet prompt for all of them) and sends them one after
 * the other, each confirmed before the next. Returns the signatures.
 */
export function useSendPrepared() {
    const { connection } = useConnection();
    const { signAllTransactions } = useWallet();

    return useCallback(
        async (prepared: string[], onProgress?: (sent: number, total: number) => void): Promise<string[]> => {
            if (!signAllTransactions) throw new Error("This wallet cannot sign transactions.");
            const txs = prepared.map((b64) => VersionedTransaction.deserialize(Buffer.from(b64, "base64")));
            const signed = await signAllTransactions(txs);
            const sigs: string[] = [];
            for (const tx of signed) {
                const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
                const signature = await connection.sendRawTransaction(tx.serialize());
                const res = await connection.confirmTransaction(
                    { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight }, "confirmed",
                );
                if (res.value.err) throw new Error(`Transaction ${signature} failed on-chain.`);
                sigs.push(signature);
                onProgress?.(sigs.length, signed.length);
            }
            return sigs;
        },
        [connection, signAllTransactions],
    );
}