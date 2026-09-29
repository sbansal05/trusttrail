import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getAddressEncoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getUtf8Encoder,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS as SAS_PROGRAM,
  fetchMaybeCredential,
  fetchMaybeSchema,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
} from "sas-lib";


const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WSS_URL = process.env.WSS_URL ?? RPC_URL.replace(/^http/, "ws");
const KEYPAIR = process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`;

const TRUSTTRAIL_PROGRAM = address("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");


const SAS_SIGNER_SEED = "sas-signer";

const CREDENTIAL_NAME = "trusttrail";
const SCHEMA_NAME = "trusttrail-repayment";
const SCHEMA_VERSION = 1;
const SCHEMA_DESCRIPTION = "One closed TrustTrail loan: who borrowed, how much, interest paid, key dates and whether it was repaid on time. Written only by the TrustTrail program";


const REPAYMENT_SCHEMA: ReadonlyArray<readonly [string, number]> = [
  ["borrower", 13], 
  ["lender_program", 13], 
  ["principal_usdc", 3], 
  ["interest_paid_usdc", 3], 
  ["opened_at", 8], ["due_at", 8], ["closed_at", 8],
  ["outcome", 0], 
  ["collateral_ratio_bps", 1], 
  ["tier_at_open", 0],
];


const utf8 = getUtf8Encoder();
const addr = getAddressEncoder();

async function findSasSignerPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: TRUSTTRAIL_PROGRAM,
    seeds: [utf8.encode(SAS_SIGNER_SEED)],
  })
  return pda;
}

async function findCredentialPda(authority: Address, name: string): Promise<Address> {
  
  const [pda] = await getProgramDerivedAddress({
    programAddress: SAS_PROGRAM,
    seeds: [utf8.encode("credential"), addr.encode(authority), utf8.encode(name)],
  })
  return pda;
}

async function findSchemaPda(credential: Address, name: string, version: number): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SAS_PROGRAM,
    seeds: [utf8.encode("schema"), addr.encode(credential), utf8.encode(name), new Uint8Array([version])],
  })
  return pda;
}



type Rpc = ReturnType<typeof createSolanaRpc>;
type RpcSubs = ReturnType<typeof createSolanaRpcSubscriptions>;

async function send(rpc: Rpc, rpcSubscriptions: RpcSubs, payer: KeyPairSigner, ixs: Instruction[], label: string) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions } as any);
  await sendAndConfirm(signed as any, { commitment: "confirmed" });
  console.log(`  ✓ ${label}: ${getSignatureFromTransaction(signed)}`);
}


async function main() {
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WSS_URL);
  const wallet = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(KEYPAIR, "utf8"))));

  const sasSigner = await findSasSignerPda();
  const credential = await findCredentialPda(wallet.address, CREDENTIAL_NAME);
  const schema = await findSchemaPda(credential, SCHEMA_NAME, SCHEMA_VERSION);
  console.log({ authority: wallet.address, sasSigner, credential, schema });



  const existing = await fetchMaybeCredential(rpc, credential);
  if(!existing.exists) {
    const ix = getCreateCredentialInstruction({ payer: wallet, credential, authority: wallet, name: CREDENTIAL_NAME, signers: [sasSigner]})
    await send(rpc, rpcSubscriptions, wallet, [ix], "Credential created")

  } else {
    console.log("Credential already exists");
  }

  const existingSchema = await fetchMaybeSchema(rpc, schema);
  if (!existingSchema.exists) {
    const ix = getCreateSchemaInstruction({
      payer: wallet,
      authority: wallet,
      credential,
      schema,
      name: SCHEMA_NAME,
      description: SCHEMA_DESCRIPTION,
      layout: new Uint8Array(REPAYMENT_SCHEMA.map(([, type]) =>type)),
      fieldNames: REPAYMENT_SCHEMA.map(([name]) => name),
    });
    await send(rpc, rpcSubscriptions, wallet, [ix], "Schema created");
  } else {
    console.log("Schema already exists");
  }
  console.log("\nCopy these into programs/trusttrail/src/constants.rs:");
  console.log(`  SAS_CREDENTIAL       = ${credential}`);
  console.log(`  SAS_REPAYMENT_SCHEMA = ${schema}`);


}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
