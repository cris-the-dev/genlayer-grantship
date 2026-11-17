# GrantShip — grants paid milestone by milestone, when the repository shows the work

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Small grants are paid on trust or after a report someone has to review by hand.
**GrantShip** escrows the whole grant and splits it into milestones with written
criteria and the file in the grantee's GitHub repository that should show them
(a changelog, a docs page). To claim, anyone names a commit; GenLayer validators
read that file at that exact commit, judge it against the criteria and quote it.
Met pays the grantee at once; not met stays open for a later commit; a missed
deadline goes back to the funder.

```
funder  ── open_grant(grantee, title, repo, [[title, criteria, path, amount, deadline], …]) + total ─▶ GrantShip
anyone  ── claim(grant, milestone, commit): validators fetch
           raw.githubusercontent.com/<repo>/<commit>/<path> and agree met | not_met (+ quote for met)
           met ─▶ PAID, amount to the grantee        not_met ─▶ recorded, still OPEN
anyone  ── reclaim(grant, milestone) after its deadline ─▶ RECLAIMED, amount to the funder
anyone  ── settle_payout(payout, tx, finalize_tx) / payee ── recover(to)
```

## Live deployment

App: https://grantship.cristhedev.com (grants, milestones, every reading with its commit and quote; source in [`app/`](app/))  
Testnet Bradbury Phase 2 (chainId 4221, GenVM v0.3): `__ADDR__`

## Bradbury evidence

Run by [`tests/integration/bradbury.mjs`](tests/integration/bradbury.mjs) once deployed; the table of transactions goes here.

## How a milestone is judged

1. **Pinned by the commit.** The file is fetched at a full 40-hex commit SHA
   (upper case is normalised) from `raw.githubusercontent.com`: the same bytes
   for every validator, forever. Paths are relative, without `..`.
2. **Whole file.** Over 60,000 characters is refused, never cut. A missing file
   or unknown commit reverts and changes nothing.
3. **One narrow question.** The LLM sees the milestone's title and criteria and
   the file, fenced as data: does the file show every criterion as done?
   Plans, to-dos and "coming soon" are `not_met`.
4. **Quoted, then checked by text.** `met` must copy the passage that shows it;
   the contract checks it is in the file.
5. **Consensus on the answer.** Each validator fetches the file itself and
   accepts the leader's result only with the same answer and, for met, the
   leader's quote in its own copy. An unreachable file is agreed only when
   reproduced; an LLM error never is.

## Where the money goes

- The whole grant is sent with `open_grant` (exactly the sum of 1–8 milestones,
  deadlines within a year) and leaves one milestone at a time:
  - **milestone** to the grantee, when a claim is `met` before the deadline;
  - **reclaim** to the funder, by anyone, after the deadline of an open milestone.
- The grantee cannot be the funder.

## Payments and settlement

Every transfer is a recorded payout (sender and creation time). `settle_payout(payout_id, tx_hash, finalize_tx)`
has validators read the paying transaction (this contract's paying method for that grant, by the recorded
sender at the recorded time, finalized with a successful result) and its finalization, and check the
transfer was executed: `DELIVERED`, or `FAILED` and recoverable by the payee with `recover(to)`.
`get_accounting` is informational only.

## Limits

- Validators judge what the file says; they do not run the code.
- A commit SHA can also be served for a fork of the repository (GitHub shares
  objects in a fork network), and commit dates are set by the author: criteria
  should name what the file must show, not when.

## The app

https://grantship.cristhedev.com ([`app/`](app/)) reads finalized state and treats a write as done only when it is `FINALIZED` with `FINISHED_WITH_RETURN`
and reading the contract back shows the change. GEN amounts use BigInt only. A claim form appears per open milestone up to its deadline;
"send back" only after it. `node app/check-actions.mjs app/index.html` (CI) asserts the controls per milestone state and time.

## API

| Method | Who | Notes |
|---|---|---|
| `open_grant(grantee, title, repo, milestones)` payable | funder | `repo` = owner/name; each milestone `[title, criteria, path, amount, deadline]` |
| `claim(grant_id, milestone, commit)` | anyone | up to the deadline; reads the file; met pays the grantee |
| `reclaim(grant_id, milestone)` | anyone | after the deadline of an open milestone; pays the funder |
| `settle_payout(payout_id, tx_hash, finalize_tx)` / `recover(to)` | anyone / payee | |
| `get_grant`, `get_grants`, `get_readings(grant_id or -1, start, limit)`, `get_payout`, `get_payouts`, `get_accounting`, `get_recoverable` | view | |

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
genvm-lint check contracts/grant_ship.py
pytest tests/direct -v                         # 37 tests
python deploy/shrink.py contracts/grant_ship.py build/grant_ship.py --pack
node tests/integration/bradbury.mjs build/grant_ship.py
```

Bradbury rejects deploys above ~20 KB; deploy the packed build (28.5 KB → 8.4 KB). CI re-runs the direct tests on it.

## Tests (37 direct)

- **Opening** — field validation (title, repo, milestone shape, path, amount, deadline, exact sum); the grantee cannot be the funder.
- **Claims** — met pays the grantee; the file is read at the named commit; not met is recorded and a later commit can claim; full SHA only, upper case normalised; a missing or too long file reverts.
- **Deadlines** — no claim after it; anyone sends it back to the funder.
- **Consensus** — agreement on the answer; the quote must be in each validator's copy (case, spacing and Markdown marks ignored); a missing file is agreed; LLM errors never agreed.
- **Settlement** — delivered and failed payouts, recovery by the grantee, a transaction that is not this payout is rejected.

## License

MIT
