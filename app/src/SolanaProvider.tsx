import type { FC, ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { RPC_URL } from "./config";

export const SolanaProvider: FC<{ children: ReactNode }> = ({ children }) => (
    <ConnectionProvider endpoint={RPC_URL}>
        <WalletProvider wallets={[]} autoConnect>
            <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
    </ConnectionProvider>
);