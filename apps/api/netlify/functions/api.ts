import type { Config } from "@netlify/functions";
import { openStore } from "../../lib/store.js";
import { handle } from "../../lib/router.js";

export default async (req: Request): Promise<Response> => handle(req, openStore());

// Global limit enforced by Netlify's edge (shared across all instances): 120 requests per minute per IP.
export const config: Config & { rateLimit: { windowLimit: number; windowSize: number; aggregateBy: string[] } } = {
  path: "/api/*",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
