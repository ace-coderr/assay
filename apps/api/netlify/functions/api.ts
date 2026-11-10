import type { Config } from "@netlify/functions";
import { openStore } from "../../lib/store.js";
import { handle } from "../../lib/router.js";

export default async (req: Request): Promise<Response> => handle(req, openStore());

export const config: Config = { path: "/api/*" };
