// End-to-end on Testnet Bradbury (Phase 2), on the packed code that is deployed:
//
//   python deploy/shrink.py contracts/grant_ship.py build/grant_ship.py --pack
//   npm i genlayer-js@2.0.0-rc.2   # plus the estimateTransactionFees patch in app/README.md
//   GL_PK0=0x... GL_PK1=0x... GL_PK2=0x... node tests/integration/bradbury.mjs build/grant_ship.py [contract]
//
// GL_PK0 funds, GL_PK1 is the grantee, GL_PK2 is anyone. The grant points at a real public repository,
// cris-the-dev/genlayer-refundwatch (REPO), and its README.md. Milestone 1 asks for approved event
// sources: claimed at v1.0.0 (7d8ca2d, before that work) validators answer not met and nothing is paid;
// claimed at v1.1.0 (5b12685) they answer met, quote the README and pay the grantee. Milestone 2 has a
// deadline minutes away: reclaim is refused before it, a claim is refused after it, then anyone sends
// its amount back to the funder. A funder paying themselves, a wrong sum and a short commit are refused.
// Every payout settles from its own transfer.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAccount, createClient, MessageType, encodeExternalMessageFeeParams } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const PRICE = 10n ** 14n, DAY = 86400;
const ARGS = [];
const REPO = process.env.REPO ?? "cris-the-dev/genlayer-refundwatch";
const BEFORE = "7d8ca2dd11b454fb5837c760bb89491117c5d1e8", AFTER = "5b126857f19cf28a7779fc733f97407eaa58da35";
const CONSENSUS_MAIN = "0x2e2766cbc3e5e61ce93bbcdcbb3eacb82082a019";
const T_FINALIZED = "0x24196ec40f90671b7144e716978686b4f3c7d6b00b23da3971ef2b52af27d87f";
const PAYOUT_GAS = 100000n, PAYOUT_GAS_PRICE = 1000000000n;
// rpc.testnet-chain.genlayer.com (the chain default) does not serve gen_call; this one serves the same chain.
const endpoint = "https://rpc-bradbury.genlayer.com";
const a0 = createAccount(process.env.GL_PK0);
const a1 = createAccount(process.env.GL_PK1);
const a2 = createAccount(process.env.GL_PK2);
const c0 = createClient({ chain: testnetBradbury, endpoint, account: a0 });
const c1 = createClient({ chain: testnetBradbury, endpoint, account: a1 });
const c2 = createClient({ chain: testnetBradbury, endpoint, account: a2 });
const sha = (t) => createHash("sha256").update(t).digest("hex");
const page = async (url) => sha(Buffer.from(await (await fetch(url)).arrayBuffer()));
const fees = async (c, payee) => {
  const messageAllocations = payee && [{
    messageType: MessageType.External, onAcceptance: false, recipient: payee, budget: PAYOUT_GAS * PAYOUT_GAS_PRICE,
    callKey: "0x" + "00".repeat(32), feeParams: encodeExternalMessageFeeParams({ gasLimit: PAYOUT_GAS, maxGasPrice: PAYOUT_GAS_PRICE }),
  }];
  // A read, so retrying a dropped connection is safe.
  let e;
  for (let i = 0; !e; i++) {
    try { e = await c.estimateTransactionFees(payee ? { messageAllocations } : {}); }
    catch (err) { if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(err?.details ?? err?.message))) throw err; await new Promise((r) => setTimeout(r, 10000)); }
  }
  return { distribution: e.distribution, feeValue: e.feeValue, ...(payee && { messageAllocations: e.messageAllocations }) };
};
// The public RPC drops connections now and then; retry the wait, never the write.
async function wait(c, hash, waitUntil = "decided") {
  for (let i = 0; ; i++) {
    try {
      return await c.waitForTransactionReceipt({ hash, waitUntil, interval: 10000, retries: 360 });
    } catch (e) {
      if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(e?.details ?? e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}
const check = (ok, what) => {
  console.log(ok ? "  ok  " : "  FAIL", what);
  if (!ok) process.exit(1);
};
// A finalized leader timeout (NOT_VOTED) or vote without a majority (NO_MAJORITY) applied nothing, so sending the call again is safe. Bradbury still
// moves the value of such a transaction, and of a reverted one, into the contract, where
// get_accounting shows it as unaccounted.
// A dropped connection while sending: send again only if the account's nonce did not move (nothing went out).
async function send(c, req) {
  for (let i = 0; ; i++) {
    const n = await rpc("eth_getTransactionCount", [c.account.address, "pending"]);
    try { return await c.writeContract(req); }
    catch (e) {
      if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(e?.details ?? e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 15000));
      if ((await rpc("eth_getTransactionCount", [c.account.address, "pending"])) !== n) throw e;
    }
  }
}
let stray = 0n;
const NONE = new Set(["NO_MAJORITY", "MAJORITY_DISAGREE"]);
async function tx(c, label, functionName, args, { value = 0n, payee } = {}) {
  for (let i = 0; ; i++) {
    const hash = await send(c, { address, functionName, args, value, fees: await fees(c, payee) });
    let r = await wait(c, hash);
    // NOT_VOTED / NO_MAJORITY can be an intermediate round (one such buy later finalized and ran on
    // Bradbury): wait for finality and retry only if it still applied nothing.
    if (r.txExecutionResultName === "NOT_VOTED" || NONE.has(r.resultName)) r = await wait(c, hash, "finalized");
    // NO_MAJORITY / MAJORITY_DISAGREE (e.g. the leader's LLM quoted text not on the page, which no
    // validator accepts): nothing was applied, whatever the leader returned.
    const res = NONE.has(r.resultName) ? r.resultName : r.txExecutionResultName;
    console.log(`${label}: ${hash} ${res}`);
    if (res !== "FINISHED_WITH_RETURN") stray += value;
    if ((res !== "NOT_VOTED" && !NONE.has(res)) || i >= 5) return { ...r, txExecutionResultName: res, hash };
  }
}
const ok = async (...a) => { const r = await tx(...a); check(r.txExecutionResultName === "FINISHED_WITH_RETURN", `${a[1]} succeeds`); return r; };
// A rejection is a transaction that ran and reverted, never one that was not voted on.
const fails = async (what, ...a) => check((await tx(...a)).txExecutionResultName === "FINISHED_WITH_ERROR", what);
const read = async (functionName, args = []) => {
  let v;
  for (let i = 0; ; i++) {
    try { v = await c0.readContract({ address, functionName, args }); break; }
    catch (e) { if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(e?.details ?? e?.message))) throw e; await new Promise((r) => setTimeout(r, 10000)); }
  }
  const plain = (x) => (x instanceof Map ? Object.fromEntries([...x].map(([k, y]) => [k, plain(y)])) : Array.isArray(x) ? x.map(plain) : x);
  return plain(v);
};
// RPC nodes behind the edge can lag the one that reported the receipt: re-read until `ok` holds (or give up).
async function settled(fn, args, ok) {
  for (let i = 0; ; i++) {
    const v = await read(fn, args);
    if (ok(v) || i >= 12) return v;
    await new Promise((r) => setTimeout(r, 10000));
  }
}
// Reads only, so retrying a dropped connection is safe.
const rpc = async (method, params) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "user-agent": "grantship-e2e" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return (await r.json()).result;
    } catch (e) { if (i >= 5) throw e; await new Promise((r) => setTimeout(r, 10000)); }
  }
};
// The consensus-layer transaction that finalized `hash`: it emits TransactionFinalized(txId).
async function finalizeTx(hash, fromBlock) {
  for (;;) {
    const to = BigInt(await rpc("eth_blockNumber", []));
    for (let b = fromBlock; b <= to; b += 1000n) {
      const end = b + 999n > to ? to : b + 999n;
      const logs = await rpc("eth_getLogs", [{ address: CONSENSUS_MAIN, topics: [T_FINALIZED, hash], fromBlock: "0x" + b.toString(16), toBlock: "0x" + end.toString(16) }]);
      if (logs?.length) return logs[0].transactionHash;
    }
    await new Promise((r) => setTimeout(r, 30000));
  }
}
async function settle(id, paid, fromBlock) {
  await wait(c0, paid.hash, "finalized");
  const fin = await finalizeTx(paid.hash, fromBlock);
  console.log(`finalized by ${fin}`);
  await ok(c2, `settle payout ${id}`, "settle_payout", [id, paid.hash, fin]);
  check((await settled("get_payout", [id], (x) => x.status === "DELIVERED")).status === "DELIVERED", `payout ${id} DELIVERED`);
  await fails("a payout settles once", c2, "settle again", "settle_payout", [id, paid.hash, fin]);
}

let address = process.argv[3];
if (!address) {
  const hash = await c0.deployContract({ code: readFileSync(process.argv[2], "utf8"), args: ARGS, fees: await fees(c0) });
  const r = await wait(c0, hash);
  address = r.txDataDecoded?.contractAddress;
  console.log(`deploy: ${hash} ${r.txExecutionResultName} -> ${address}`);
  check(r.txExecutionResultName === "FINISHED_WITH_RETURN", "deployed");
}
const fromBlock = BigInt(await rpc("eth_blockNumber", []));
stray = BigInt((await read("get_accounting")).unaccounted);
const pid = Number((await read("get_accounting")).payout_count), low = (x) => x?.toLowerCase();
const now = () => Math.floor(Date.now() / 1000), sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const funder = a0.address, grantee = a1.address;
const gid = Number((await read("get_grants", [0, 1])).total);
const raw = async (commit) => (await (await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/README.md`)).text()).replace(/\s+/g, " ").toLowerCase();
check(!(await raw(BEFORE)).includes("approved") && (await raw(AFTER)).includes("approved"), "README.md mentions approved sources at v1.1.0 only");
const ms = (soon) => [
  ["Approved event sources", "The README documents that an event's page must be on a host the contract owner approved, and that a page on any other host is refused.", "README.md", PRICE, now() + 30 * DAY],
  ["Ticket tiers", "The README documents ticket tiers: each event sells up to four named tiers, each with its own price and number of seats.", "README.md", PRICE, soon],
];

await fails("the funder cannot be the grantee", c0, "open a grant to oneself", "open_grant", [funder, "RefundWatch v1.1", REPO, ms(now() + DAY)], { value: 2n * PRICE });
await fails("the sum of the milestones must be sent", c0, "open paying one milestone", "open_grant", [grantee, "RefundWatch v1.1", REPO, ms(now() + DAY)], { value: PRICE });
await ok(c0, "open the grant (two milestones)", "open_grant", [grantee, "RefundWatch v1.1", REPO, ms(now() + 90 * 60)], { value: 2n * PRICE });
await fails("reclaim is refused before the deadline", c2, "reclaim milestone 2 early", "reclaim", [gid, 1], { payee: funder });
let g = await settled("get_grant", [gid], (x) => !!x?.repo);
check(g.milestones.length === 2 && BigInt(g.total) === 2n * PRICE, "grant open, 2 milestones held");
await fails("a commit must be a full 40-hex SHA", c2, "claim with a short commit", "claim", [gid, 0, AFTER.slice(0, 7)], { payee: grantee });
const nm = await ok(c2, "claim milestone 1 at v1.0.0", "claim", [gid, 0, BEFORE], { payee: grantee });
g = await settled("get_grant", [gid], (x) => Number(x.milestones[0].tries) === 1);
check(g.milestones[0].status === "OPEN" && BigInt(g.paid) === 0n, "not met at v1.0.0: nothing paid, milestone still open");
const p1 = await ok(c2, "claim milestone 1 at v1.1.0", "claim", [gid, 0, AFTER], { payee: grantee });
g = await settled("get_grant", [gid], (x) => x.milestones[0].status !== "OPEN");
const m = g.milestones[0];
check(m.status === "PAID" && m.commit === AFTER && (await raw(AFTER)).includes(m.quote.toLowerCase()), `met at v1.1.0, quoted: “${m.quote}”`);
const rd = (await read("get_readings", [gid, 0, 10])).items;
check(rd.map((x) => x.answer).join() === "not_met,met", "both readings recorded");
await fails("a paid milestone pays once", c2, "claim milestone 1 again", "claim", [gid, 0, AFTER], { payee: grantee });

const left = Number(g.milestones[1].deadline) - now() + 60;
if (left > 0) { console.log(`waiting ${Math.ceil(left / 60)} min for milestone 2's deadline…`); await sleep(left); }
await fails("a claim after the deadline is refused", c1, "claim milestone 2 late", "claim", [gid, 1, AFTER], { payee: grantee });
const p2 = await ok(c2, "reclaim milestone 2 (anyone sends it)", "reclaim", [gid, 1], { payee: funder });
g = await settled("get_grant", [gid], (x) => x.milestones[1].status !== "OPEN");
check(g.milestones[1].status === "RECLAIMED" && BigInt(g.reclaimed) === PRICE, "RECLAIMED to the funder");

const ps = [];
for (let i = 0; i < 2; i++) ps.push(await settled("get_payout", [pid + i], (x) => !!x?.kind));
const pays = [["milestone", PRICE, grantee], ["reclaim", PRICE, funder]];
pays.forEach(([kind, amount, to], i) => check(ps[i].kind === kind && BigInt(ps[i].amount) === amount && low(ps[i].to) === low(to), `payout ${pid + i}: ${kind} ${amount} to ${to.slice(0, 8)}`));
for (const [i, t] of [p1, p2].entries()) await settle(pid + i, t, fromBlock);
check(BigInt((await read("get_accounting")).unaccounted) === stray, `balance matches what the contract expects to hold (+${stray} from unexecuted or reverted txs)`);
console.log("contract", address, "grant", gid, "not met", nm.hash);
