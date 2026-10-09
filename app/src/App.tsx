import { BrowserRouter, Link, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { ScorePage } from "./pages/ScorePage";
import { ImportPage } from "./pages/ImportPage";
import { RecordPage } from "./pages/RecordPage";
import { BorrowPage } from "./pages/BorrowPage";
import { PoolPage } from "./pages/PoolPage";
import { PartnerPage } from "./pages/PartnerPage";
export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Northwind is a different lender, so it keeps its own header, outside TrustTrail's layout. */}
                <Route path="partner" element={<PartnerPage />} />
                <Route path="partner/:wallet" element={<PartnerPage />} />
                <Route element={<Layout />}>
                    <Route index element={<HomePage />} />
                    <Route path="score" element={<ScorePage />} />
                    <Route path="score/import" element={<ImportPage />} />
                    <Route path="borrow" element={<BorrowPage />} />
                    <Route path="pool" element={<PoolPage />} />
                    <Route path="record" element={<RecordPage />} />
                    <Route path="record/:wallet" element={<RecordPage />} />
                    <Route
                        path="*"
                        element={<main className="tt-page"><p>Page not found. <Link to="/">Go home</Link></p></main>}
                    />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
