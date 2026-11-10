import type { AssayBackend } from "@assay/mcp";
import type { Store } from "./store.js";
import { ageSec, check, findReading, getActions, getLatest, probe } from "./service.js";
import { DISCLAIMER } from "@assay/core";

const unavailable = { status: "unavailable", reason: "no readings stored yet" };

export function mcpBackend(store: Store): AssayBackend {
  return {
    async board() {
      const doc = await getLatest(store);
      if (!doc) return unavailable;
      return {
        updatedAt: doc.updatedAt,
        ageSec: Math.round(ageSec(doc)),
        sources: doc.sources,
        untrackedTokens: doc.untracked,
        readings: doc.readings.map((r) => ({
          symbol: r.symbol,
          status: r.status,
          state: r.state,
          dexPrice: r.dexPrice,
          reference: r.reference,
          deviationBps: r.deviationBps,
          unavailableReason: r.unavailableReason,
          reasons: r.reasons,
        })),
        disclaimer: DISCLAIMER,
      };
    },
    async token(symbol) {
      const doc = await getLatest(store);
      const r = findReading(doc, symbol);
      if (!r) return { status: "unavailable", reason: `unknown or untracked symbol: ${symbol}` };
      return { reading: r, sources: doc!.sources, ageSec: Math.round(ageSec(doc)), disclaimer: DISCLAIMER };
    },
    async actions(symbol) {
      return { actions: (await getActions(store, symbol)).slice(0, 50), disclaimer: DISCLAIMER };
    },
    async probe(symbol, usd, side) {
      return probe(await getLatest(store), symbol, usd, side);
    },
    async check(symbol, usd, side) {
      return check(await getLatest(store), symbol, usd, side);
    },
  };
}
