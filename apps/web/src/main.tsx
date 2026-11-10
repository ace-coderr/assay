import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import { AppShell, PageShell } from "./components/Layout";
import Landing from "./pages/Landing";
import Board from "./pages/Board";
import Token from "./pages/Token";
import Actions from "./pages/Actions";
import Liquidity from "./pages/Liquidity";
import Watchlist from "./pages/Watchlist";
import Agent from "./pages/Agent";
import Attestations from "./pages/Attestations";
import Method from "./pages/Method";
import BuildStatus from "./pages/BuildStatus";

function NotFound() {
  return (
    <div className="wrap" style={{ paddingTop: 80 }}>
      <h1>Page not found</h1>
      <p className="muted">That page does not exist. <a href="#/app">Go to the board</a>.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<PageShell />}>
          <Route index element={<Landing />} />
          <Route path="app" element={<AppShell />}>
            <Route index element={<Board />} />
            <Route path="token" element={<Token />} />
            <Route path="token/:symbol" element={<Token />} />
            <Route path="actions" element={<Actions />} />
            <Route path="liquidity" element={<Liquidity />} />
            <Route path="watchlist" element={<Watchlist />} />
            <Route path="agent" element={<Agent />} />
            <Route path="attestations" element={<Attestations />} />
            <Route path="method" element={<Method />} />
            <Route path="status" element={<BuildStatus />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
