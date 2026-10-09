import { Link, NavLink, Outlet } from "react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Layout() {
    const { publicKey } = useWallet();
    const recordPath = publicKey ? `/record/${publicKey.toBase58()}` : "/record";
    return (
        <>
            <header className="tt-header">
                <div className="tt-header-inner">
                    <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
                        <Link to="/" className="tt-brand">TrustTrail</Link>
                        <nav className="tt-nav" aria-label="Main">
                            <NavLink to="/score">Score</NavLink>
                            <NavLink to="/borrow">Borrow</NavLink>
                            <NavLink to={recordPath}>Public record</NavLink>
                        </nav>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="tt-pill tt-mono tt-muted">devnet</span>
                        <WalletMultiButton />
                    </div>
                </div>
            </header>
            <Outlet />
        </>
    );
}
