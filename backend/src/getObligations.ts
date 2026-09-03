import crypto from "node:crypto";
import bs58 from "bs58";
import klendIdl from "@kamino-finance/klend-sdk/dist/idl/klend.json";
import { getAllTransactions } from "./heliusScore";

const KAMINO_PROGRAM_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const TEST_WALLET = "EyNqbQz3e9XcB9vasnqQjJHYTgH7a28iiPh58pXxPq84";


const NO_BORROW_HISTORY_SCORE = 200;


const LIQUIDATION_BASE_PENALTY = 100;

const KAMINO_ACTION_MAP: Record<string, "borrow" | "repay" | "liquidate" | "collateral"> = {
    borrowObligationLiquidity: "borrow",
    borrowObligationLiquidityV2: "borrow",
    repayObligationLiquidity: "repay",
    repayObligationLiquidityV2: "repay",
    repayAndWithdrawAndRedeem: "repay",
    liquidateObligationAndRedeemReserveCollateral: "liquidate",
    liquidateObligationAndRedeemReserveCollateralV2: "liquidate",
    depositObligationCollateral: "collateral",
    depositObligationCollateralV2: "collateral",
    withdrawObligationCollateral: "collateral",
    withdrawObligationCollateralV2: "collateral",
};

function computeDiscriminator(instructionName: string): string {
    const hash = crypto.createHash("sha256").update(`global:${instructionName}`).digest();
    return hash.subarray(0, 8).toString("hex");
}


function camelToSnake(name: string): string {
    return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const DISCRIMINATOR_MAP = new Map<string, string>();
for (const ix of (klendIdl as any).instructions) {
    DISCRIMINATOR_MAP.set(computeDiscriminator(camelToSnake(ix.name)), ix.name);
}

function getInstructionName(rawData: string): string | undefined {
    const bytes = bs58.decode(rawData);
    const discriminatorHex = Buffer.from(bytes.slice(0, 8)).toString("hex");
    return DISCRIMINATOR_MAP.get(discriminatorHex);
}

type KaminoActionCounts = Record<"borrow" | "repay" | "liquidate" | "collateral", number>;

export async function getKaminoActionCounts(walletAddress: string): Promise<KaminoActionCounts> {
    const allTransactions = await getAllTransactions(walletAddress);
    const counts: KaminoActionCounts = { borrow: 0, repay: 0, liquidate: 0, collateral: 0 };

    for (const tx of allTransactions) {
        const message = (tx.transaction as any).message;
        for (const instruction of message.instructions) {
            const programId = message.accountKeys[instruction.programIdIndex];
            if (programId !== KAMINO_PROGRAM_ID) continue;

            const name = getInstructionName(instruction.data);
            if (!name) continue;

            const action = KAMINO_ACTION_MAP[name];
            if (!action) continue;

            counts[action]++;
        }
    }

    return counts;
}

export function computeRepaymentScore(counts: KaminoActionCounts): number {
    if (counts.borrow === 0) {
        return NO_BORROW_HISTORY_SCORE;
    }
    return Math.min(counts.repay / counts.borrow, 1) * 1000;
}

export function computeLiquidationScore(counts: KaminoActionCounts): number {
    
    let penalty = 0;
    for (let i = 1; i <= counts.liquidate; i++) {
        penalty += i * LIQUIDATION_BASE_PENALTY;
    }
    return Math.max(1000 - penalty, 0);
}

async function main() {
    const counts = await getKaminoActionCounts(TEST_WALLET);
    console.log("action counts:", counts);
    console.log("repayment score:", computeRepaymentScore(counts));
    console.log("liquidation score:", computeLiquidationScore(counts));

    const fakeCounts: KaminoActionCounts = { borrow: 2, repay: 2, liquidate: 1, collateral: 2 };
    console.log("fake data repayment score (expect 1000):", computeRepaymentScore(fakeCounts));
    console.log("fake data liquidation score (expect 900):", computeLiquidationScore(fakeCounts));

    const noBorrowCounts: KaminoActionCounts = { borrow: 0, repay: 0, liquidate: 0, collateral: 0 };
    console.log("no-borrow repayment score (expect 200):", computeRepaymentScore(noBorrowCounts));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}