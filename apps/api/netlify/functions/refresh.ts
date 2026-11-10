import type { Config } from "@netlify/functions";
import { openStore } from "../../lib/store.js";
import { runRefresh } from "../../lib/refresh.js";

// Scheduled reading every 5 minutes. Runs on Netlify, not on any developer machine.
export default async (): Promise<Response> => {
  const doc = await runRefresh({ store: openStore() });
  return Response.json({ updatedAt: doc.updatedAt, readings: doc.readings.length, sources: doc.sources });
};

export const config: Config = { schedule: "*/5 * * * *" };
