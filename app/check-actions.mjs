// Asserts which GrantShip app controls appear per milestone state and time, and that GEN amounts are exact
// (run: node app/check-actions.mjs app/index.html).
import { readFileSync } from "node:fs";
const html = readFileSync(process.argv[2], "utf8");
const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const body = js.slice(js.indexOf("function actions"), js.indexOf("async function show"));
const gl = readFileSync(new URL("./gl.js", import.meta.url), "utf8");
const pick = (name) => gl.slice(gl.indexOf(`export const ${name} =`), gl.indexOf("\n};\n", gl.indexOf(`export const ${name} =`)) + 3).replace("export ", "");
const { gen, toWei } = new Function(`${pick("gen")}\n${pick("toWei")}\nreturn { gen, toWei };`)();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const line = (name) => js.match(new RegExp(`const ${name} = .*;`))[0];
const make = new Function("esc", "gen", "B", "short", "EXPLORER", "ctx", `let me = ctx.me; const when = (t) => String(t); ${line("addr")} ${body}; return { actions, reading };`);
const NOW = 1000, P = 10n ** 15n;
const m = (o = {}) => ({ title: "CSV export", criteria: "c", path: "CHANGELOG.md", amount: P, deadline: NOW + 10, status: "OPEN", commit: "", quote: "", tries: 0, ...o });
const grant = { id: 0, funder: "0xF", grantee: "0xG", repo: "a/b", milestones: [m(), m({ title: "<Docs>", amount: 2n * P, deadline: NOW + 20 })] };
const fns = (me) => make(esc, gen, BigInt, (a) => a, "x", { me });
const run = (me, ms, recov = 0, now = NOW) => fns(me).actions({ ...grant, ...(ms && { milestones: ms }) }, recov, now);
const count = (s, x) => s.split(x).length - 1;
const check = (name, ok) => { console.log(ok ? "ok  " : "FAIL", name); if (!ok) process.exitCode = 1; };

check("no wallet: prompt only", run(null).includes("Connect a wallet") && !run(null).includes("form"));
check("anyone claims each open milestone before its deadline, with its amount", count(run("0xX"), 'data-form="claim"') === 2 && run("0xX").includes("Claim 0.002 GEN"));
check("the claim asks for a full SHA", run("0xX").includes('pattern="[0-9a-fA-F]{40}"'));
check("paid or reclaimed milestones take no button", count(run("0xX", [m({ status: "PAID" }), m({ status: "RECLAIMED" })], 0, NOW + 99), "data-form") === 0);
check("deadline: claim up to it, reclaim only after", run("0xX", [m()], 0, NOW + 10).includes('data-form="claim"') && !run("0xX", [m()], 0, NOW + 10).includes("reclaim") && run("0xX", [m()], 0, NOW + 11).includes('data-form="reclaim"') && !run("0xX", [m()], 0, NOW + 11).includes('data-form="claim"'));
check("titles are escaped", run("0xX").includes("&lt;Docs&gt;") && !run("0xX").includes("<Docs>"));
check("recover only with a failed transfer", run("0xX", undefined, 5n).includes('data-form="recover"') && !run("0xX", undefined, 0n).includes("recover"));
const r = fns("0xX").reading;
check("reading: met quotes the file, links the commit", r({ answer: "met", milestone: 0, commit: "a".repeat(40), quote: "<q>", reason: "ok", by: "0xB", at: 1 }, grant).includes("&lt;q&gt;") && r({ answer: "met", milestone: 0, commit: "a".repeat(40), quote: "q", reason: "", by: "0xB", at: 1 }, grant).includes("/blob/" + "a".repeat(40) + "/CHANGELOG.md"));
check("reading: not met shows no quote", !r({ answer: "not_met", milestone: 0, commit: "b".repeat(40), quote: "", reason: "planned", by: "0xB", at: 1 }, grant).includes("“"));
check("exact amounts", gen(10n ** 14n) === "0.0001" && toWei("0.009007199254740993") === 9007199254740993n);
