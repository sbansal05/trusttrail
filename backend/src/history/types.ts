export type Protocol = "kamino" | "marginfi" | "save" | "jupiter_lend" | "loopscale";

export type CreditEvent = {
    protocol: Protocol;
    wallet: string;
    position: string;

    kind: "borrow" | "repay" | "liquidation";

    
        mint: string;
        amount: bigint;
        decimals: number;


    

    timestamp: number; //seconds

    signature: string;   // tx signature
    
    dueAt: number;
};

/** A closed borrow cycle built from CreditEvents. */
export type Loan = {
    protocol: Protocol;
    wallet: string;
    position: string;
    mint: string;
    decimals: number;

    // principal = peak outstanding debt: the most the lender had at risk at once.
    // Total borrowed can be inflated by borrow/repay loops.
    
    principal: bigint;
    openedAt: number;
    closedAt: number;
    dueAt: number;
    //0 = no due date
    //outcome for kamino: 0 | 2
    outcome: 0 | 1 | 2 | 3;
    
    // When the debt reached its peak (F10: the loan is priced at this moment).
    peakAt: number;
    // Proof for anyone checking the import (F15): first borrow, the borrow that set the peak,
    // and the repay or liquidation that closed the loan.
    openSignature: string;
    peakSignature: string;
    endSignature: string;
};