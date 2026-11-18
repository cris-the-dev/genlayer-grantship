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
Testnet Bradbury Phase 2 (chainId 4221, GenVM v0.3): [`0xE29A3247E5C89e6297C250DaA2da2267c59D4C87`](https://explorer-bradbury.genlayer.com/address/0xE29A3247E5C89e6297C250DaA2da2267c59D4C87)

## Bradbury evidence

Run by [`tests/integration/bradbury.mjs`](tests/integration/bradbury.mjs) on Bradbury Phase 2 (all checks passed). Contract `0xE29A3247E5C89e6297C250DaA2da2267c59D4C87` (deploy [`0xefcf8dbb…`](https://explorer-bradbury.genlayer.com/tx/0xefcf8dbb53e5b62fda40968f4ad55049b4b58f457bef2bddb65d3d8c17ec3730)), code `build/grant_ship.py` (sha256 `d3a05eb6…`). Funder, grantee and a third account are separate. Grant #0 "RefundWatch v1.1" names the repository [`cris-the-dev/genlayer-refundwatch`](https://github.com/cris-the-dev/genlayer-refundwatch) and two milestones of 0.0001 GEN each, both checked against `README.md`: "Approved event sources" (30 days) and "Ticket tiers" (deadline minutes away).

| Step | Transaction | Outcome |
|---|---|---|
| open a grant to oneself | [`0x99c3ddaa…`](https://explorer-bradbury.genlayer.com/tx/0x99c3ddaa7ad330b96854f158a76e1a62625c748946730eaf78f75009c28a48c0) | rejected: the funder cannot be the grantee |
| open paying one milestone | [`0xbd972691…`](https://explorer-bradbury.genlayer.com/tx/0xbd9726914c9e9966f04a5687c71ad44f5aa467126d5db24d6515149ceac21f98) | rejected: the sum of the milestones must be sent |
| open the grant (two milestones) | [`0x6d60ffb7…`](https://explorer-bradbury.genlayer.com/tx/0x6d60ffb761dd9dc2338e831cb695937e7451a0c4d4abd05ec9ac450874091aca) | ok: grant #0, 0.0002 GEN held |
| reclaim milestone 2 early | [`0x0738d8d6…`](https://explorer-bradbury.genlayer.com/tx/0x0738d8d6e8182c1e0edd390cb56a55453de5cb22ff445081777a81997944b66d) | rejected: the deadline has not passed |
| claim with a short commit | [`0xfc06cbc8…`](https://explorer-bradbury.genlayer.com/tx/0xfc06cbc8db1ee40c161ecc7ff4bd1c6b0b1edc5c7083679d1b1f8503b3228aef) | rejected: a commit must be a full 40-hex SHA |
| claim milestone 1 at [`7d8ca2d`](https://github.com/cris-the-dev/genlayer-refundwatch/blob/7d8ca2dd11b454fb5837c760bb89491117c5d1e8/README.md) (v1.0.0) | [`0xc42af3b9…`](https://explorer-bradbury.genlayer.com/tx/0xc42af3b9e06be54b2c15467b11330017c582f62dfe65ff41de6cb36d4bec3c3a) | **`not_met`**: reading recorded, nothing paid, milestone still OPEN |
| claim milestone 1 at [`5b12685`](https://github.com/cris-the-dev/genlayer-refundwatch/blob/5b126857f19cf28a7779fc733f97407eaa58da35/README.md) (v1.1.0) | [`0xc08f3526…`](https://explorer-bradbury.genlayer.com/tx/0xc08f3526cf0b231bd80e4aa642ba7fb06a47e8b624208fd1aaffb115b1203fd2) | **`met`**, quoted: “A page must be `https://` on an approved host or one of its subdomains, with no user name or port. Any other page, such as an organizer's own site, a look-alike domain or a host that merely contains an approved name, is refused before it is read,” PAID, 0.0001 GEN to the grantee = payout 0 |
| claim milestone 1 again | [`0x20540acf…`](https://explorer-bradbury.genlayer.com/tx/0x20540acf7f96bb43e502c9d44fa3a5d996a9a38c300ec323850f05ea57838582) | rejected: already paid |
| claim milestone 2 late | [`0xa33186f8…`](https://explorer-bradbury.genlayer.com/tx/0xa33186f8ec5fe5a1a94045f71983f5aa3aeb48a6da3f9fe1c9583e74d497073c) | rejected: the deadline has passed |
| reclaim milestone 2 (anyone sends it) | [`0xdc603d1c…`](https://explorer-bradbury.genlayer.com/tx/0xdc603d1c87f9d6f2460a7ff260d4bd6066332095c8028b7f26efd3a510b3027d) | RECLAIMED, 0.0001 GEN to the funder = payout 1 (sent by the third account) |

Every payout was settled from its own transfer once the paying transaction finalized:

| Payout | Kind | Paid by | Finalized by | `settle_payout` | Result |
|---|---|---|---|---|---|
| 0 | milestone 1 → grantee | [`0xc08f3526…`](https://explorer-bradbury.genlayer.com/tx/0xc08f3526cf0b231bd80e4aa642ba7fb06a47e8b624208fd1aaffb115b1203fd2) | [`0x0824815c…`](https://explorer-bradbury.genlayer.com/tx/0x0824815c5c94132502759db19829421962ae7e09fbd85f88d69d73b3c59d8c16) | [`0x7af83af0…`](https://explorer-bradbury.genlayer.com/tx/0x7af83af05f0e088149b4f0380a229248a446c9ce19c60d215586cb89bfee3e6a) | DELIVERED |
| 1 | milestone 2 reclaimed → funder | [`0xdc603d1c…`](https://explorer-bradbury.genlayer.com/tx/0xdc603d1c87f9d6f2460a7ff260d4bd6066332095c8028b7f26efd3a510b3027d) | [`0xa2166862…`](https://explorer-bradbury.genlayer.com/tx/0xa2166862710e1037a746dcd955e597c1bb4be7a97ccd24f1c0e1306f530c32fd) | [`0x3ab09731…`](https://explorer-bradbury.genlayer.com/tx/0x3ab09731c290e559ad3c817c7774e884e48c1a1e568a4b3c5d762b2596c53e83) | DELIVERED |

Settling the same payout again is rejected ([`0xe8d8cdce…`](https://explorer-bradbury.genlayer.com/tx/0xe8d8cdce711d8f1ba746ff665b61701a3c1cc88238c5a858f58b8fefafc027fe), [`0x14026459…`](https://explorer-bradbury.genlayer.com/tx/0x14026459d9d92699421c8f4a7915569105f2c02e84d7117424e665dbe46f21d5)). On Bradbury a reverted payable transaction leaves its value in the contract; the contract never recorded it, so no one can withdraw it. The E2E checks the balance equals what the contract expects to hold plus exactly that value (0.0003 GEN).

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
