//! TrustTrail admin instructions, built by hand. Account order must match the program's
//! account structs; the IDL test in history/importFlow.test.ts checks it.

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TRUSTTRAIL_PROGRAM_ID, reputationPda, whitelistPda } from "../history/chain";
import { discriminator } from "../history/importTx";

const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

export const GLOBAL_CONFIG = PublicKey.findProgramAddressSync([Buffer.from("global-config")], TRUSTTRAIL_PROGRAM_ID)[0];
/** TrustTrail's ProgramData account; `initialize` reads the upgrade authority from it. */
export const PROGRAM_DATA = PublicKey.findProgramAddressSync([TRUSTTRAIL_PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];

/** Creates GlobalConfig. `admin` must be the program's upgrade authority and becomes the admin. */
export function initializeIx(admin: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: admin, isSigner: true, isWritable: true },
            { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: true },
            { pubkey: TRUSTTRAIL_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: PROGRAM_DATA, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: discriminator("initialize"),
    });
}

export function initWhitelistIx(admin: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: admin, isSigner: true, isWritable: true },
            { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },
            { pubkey: whitelistPda(), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: discriminator("init_writer_whitelist"),
    });
}

export function addWriterIx(admin: PublicKey, writer: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: admin, isSigner: true, isWritable: false },
            { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },
            { pubkey: whitelistPda(), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([discriminator("add_writer"), writer.toBuffer()]),
    });
}


/** Lowers one wallet's stored exposure to `exposureBps` (admin only, until the program's deadline). */
export function setExposureIx(admin: PublicKey, wallet: PublicKey, exposureBps: bigint): TransactionInstruction {
    const data = Buffer.alloc(16);
    discriminator("set_exposure").copy(data, 0);
    data.writeBigUInt64LE(exposureBps, 8);
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: admin, isSigner: true, isWritable: false },
            { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },
            { pubkey: reputationPda(wallet), isSigner: false, isWritable: true },
        ],
        data,
    });
}