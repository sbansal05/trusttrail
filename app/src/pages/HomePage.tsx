import { Link } from "react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { GuillocheBackground } from "../GuillocheBackground";

export function HomePage() {
    const { publicKey } = useWallet();
    return (
        <main style={{ position: "relative", overflow: "hidden" }}>
            <GuillocheBackground />
            <div className="tt-page" style={{ position: "relative", paddingTop: 72, paddingBottom: 72, maxWidth: 760 }}>
                <h1 className="tt-display" style={{ fontSize: 48 }}>Your repayment record, portable across Solana</h1>
                <p className="tt-muted" style={{ fontSize: 17 }}>
                    TrustTrail turns the loans you have repaid on Kamino, MarginFi, Save, Jupiter Lend and Loopscale into a score, and
                    every loan you repay here into a public on-chain record any lender can read. Better record, better terms.
                </p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    {publicKey ? (
                        <Link to="/score" className="tt-button-primary" style={{ padding: "0 22px", minHeight: 44, borderRadius: 8 }}>See my score</Link>
                    ) : (
                        <WalletMultiButton />
                    )}
                    <Link to="/record" className="tt-button-secondary">Look up a wallet</Link>
                </div>
                <p className="tt-muted">Runs on Solana devnet with tUSDC, a test token.</p>
            </div>
        </main>
    );
}
