import { PublicKey, Connection, Keypair, SystemProgram } from "@solana/web3.js";
import {Program, AnchorProvider, Wallet} from "@coral-xyz/anchor";
import idl from "../../target/idl/trusttrail.json"
process.loadEnvFile();

const PROGRAM_ID = new PublicKey("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");
const GLOBAL_CONFIG_SEED = Buffer.from("global-config");

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    const secret = new Uint8Array(JSON.parse(process.env.AUTHORITY_PRIVATE_KEY!));
    const authorityKeypair = Keypair.fromSecretKey(secret);
    

    const [globalConfigPda] = PublicKey.findProgramAddressSync(
        [GLOBAL_CONFIG_SEED],
        PROGRAM_ID
    );

    const provider = new AnchorProvider(connection, new Wallet(authorityKeypair), {});
    const program = new Program(idl as any, provider);

    // const tx = await program.methods
    //     .initialize()
    //     .accounts({
    //         authority: authorityKeypair.publicKey,
    //         globalConfig: globalConfigPda,
    //         systemProgram: SystemProgram.programId,
    //     })
    //     .signers([authorityKeypair])
    //     .rpc();

        
        const account = await program.account.globalConfig.fetch(globalConfigPda);
        console.log("GlobalConfig on-chain:", account);

    //console.log("initialize sent! tx signature:", tx);
}

main();


