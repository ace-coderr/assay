// HEAD/GET the external link targets used by the app. Hosts that block bots (basescan, x.com) are reported as such, not as OK.
const urls = [
  "https://github.com/ace-coderr/assay",
  "https://github.com/ace-coderr/assay/blob/main/docs/data-sources.md",
  "https://github.com/ace-coderr/assay/blob/main/docs/verification.md",
  "https://x.com/_ace_won",
  "https://basescan.org/address/0x294666AD6a415E8C33Af801225c04079BB4f1133",
  "https://sepolia.basescan.org/address/0xa386fc75bcc1646569028623602e9b19e1eacee0",
  "https://sepolia.basescan.org/tx/0x112d9b5a64acffbe90f17ef073abf773cabe0fc535a4a478cc411b1e7a623dff",
];
for (const u of urls) {
  try {
    const r = await fetch(u, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (link check)" }, signal: AbortSignal.timeout(15000) });
    const server = r.headers.get("server") ?? "";
    const blocked = r.status === 403 || r.status === 429 || (r.headers.get("cf-mitigated") ?? "") !== "";
    console.log(String(r.status).padEnd(4), blocked ? "BOT-BLOCKED (cannot verify)" : r.status < 400 || r.status === 301 || r.status === 302 ? "ok" : "BROKEN", u, server ? `[${server}]` : "");
  } catch (e) {
    console.log("ERR ", u, e.message);
  }
}
