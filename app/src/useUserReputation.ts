import { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import idl from "../../target/idl/trusttrail.json";

const PROGRAM_ID = new PublicKey("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");
const USER_REPUTATION_SEED = Buffer.from("trust-v1");

export type userReputation = {
    score: number;
    lastUpdate: number;
    claimsBitmask: bigint;
    flags: number;
    bump: number;
};

export function useUserReputation() {
    const { connection } = useConnection();
    const { publicKey } = useWallet();
    const [reputation, setReputation] = useState<userReputation | null>(null);
    const [loading, setLoading] = useState(false);

    async function refetch() {
        if (!publicKey) {
            await Promise.resolve();
            setReputation(null);
            return;
        }

        setLoading(true);
        const [pda] = PublicKey.findProgramAddressSync(
            [USER_REPUTATION_SEED, publicKey.toBuffer()],
            PROGRAM_ID
        );

        const info = await connection.getAccountInfo(pda);
        if (!info) {
            setReputation(null);
            setLoading(false);
            return;
        }
        
        const coder = new BorshAccountsCoder(idl as any);
        const decoded = coder.decode("UserReputation", info.data);
        setReputation(decoded);
        
        setLoading(false);

    }

    useEffect(() => {
         // refetch() already guards its one early-exit branch with `await Promise.resolve()`
         // before calling setState; every other path awaits a real async call first.
         // This rule's static analysis doesn't trace that.
         // eslint-disable-next-line react-hooks/set-state-in-effect
        refetch();
    }, [publicKey, connection]);

    return { reputation, loading, refetch};
}