"""Opening a grant, claims against a pinned commit, reclaims after the deadline and payout settlement."""

import pytest

from tests.direct.conftest import CRITERIA, DAY, PART, QUOTE, REPO, SHA, SHA2, chain_balance, open_grant, page, tick, to_hex

OTHER = "0x" + "77" * 20
NOT_MET = {"answer": "not_met", "reason": "Export is only planned."}

def claim(vm, c, who, ms=0, commit=SHA, **kw):
    page(vm, **kw)
    vm.sender = who
    tick(vm)
    return c.claim(0, ms, commit)

def test_open(grant, direct_alice, direct_bob):
    g = grant.get_grant(0)
    assert (g["funder"].lower(), g["grantee"].lower(), g["repo"], g["total"]) == (to_hex(direct_alice).lower(), to_hex(direct_bob).lower(), REPO, 2 * PART)
    assert [m["status"] for m in g["milestones"]] == ["OPEN", "OPEN"] and g["milestones"][0]["criteria"] == CRITERIA
    assert grant.get_accounting()["expected_balance"] == 2 * PART

@pytest.mark.parametrize(
    "kw, msg",
    [
        ({"title": "x"}, "3-120"),
        ({"repo": "https://github.com/a/b"}, "owner/name"),
        ({"milestones": []}, "1-8 milestones"),
        ({"milestones": [["x", CRITERIA, "a.md", PART, 1_900_000_000]]}, "milestone title 3-120"),
        ({"milestones": [["CSV export", "short", "a.md", PART, 1_900_000_000]]}, "criteria 10-1000"),
        ({"milestones": [["CSV export", CRITERIA, "../etc/passwd", PART, 1_900_000_000]]}, "path must be a file"),
        ({"milestones": [["CSV export", CRITERIA, "a.md", PART, 1]]}, "deadline within a year"),
        ({"milestones": [["CSV export", CRITERIA, "a.md", 0, 1_900_000_000]]}, "amount above 0"),
        ({"value": 1}, "send exactly the sum"),
    ],
)
def test_open_validation(grant, direct_vm, direct_alice, direct_charlie, kw, msg):
    with direct_vm.expect_revert(msg):
        open_grant(direct_vm, grant, direct_alice, direct_charlie, **kw)
    assert grant.get_grants(0, 10)["total"] == 1

def test_the_grantee_cannot_be_the_funder(grant, direct_vm, direct_alice):
    with direct_vm.expect_revert("cannot be the funder"):
        open_grant(direct_vm, grant, direct_alice, direct_alice)

def test_a_met_milestone_pays_the_grantee(grant, direct_vm, direct_bob, direct_charlie, ledger):
    assert claim(direct_vm, grant, direct_charlie) == "met"  # anyone claims
    m = grant.get_grant(0)["milestones"][0]
    assert (m["status"], m["commit"], m["quote"]) == ("PAID", SHA, QUOTE) and ledger.paid_to(direct_bob) == PART
    with direct_vm.expect_revert("milestone is PAID"):
        claim(direct_vm, grant, direct_charlie)

def test_the_file_is_read_at_the_named_commit(grant, direct_vm, direct_charlie):
    import gltest.direct.wasi_mock as wm

    seen, original = [], wm._handle_web_request
    wm._handle_web_request = lambda vm, data: (seen.append(data.get("url")), original(vm, data))[1]
    try:
        claim(direct_vm, grant, direct_charlie)
    finally:
        wm._handle_web_request = original
    assert seen == [f"https://raw.githubusercontent.com/{REPO}/{SHA}/CHANGELOG.md"]

def test_not_met_records_and_a_later_commit_can_claim(grant, direct_vm, direct_bob, direct_charlie, ledger):
    assert claim(direct_vm, grant, direct_charlie, **NOT_MET) == "not_met"
    assert grant.get_grant(0)["milestones"][0]["status"] == "OPEN" and ledger.paid_to(direct_bob) == 0
    assert claim(direct_vm, grant, direct_charlie, commit=SHA2) == "met"
    r = grant.get_readings(0, 0, 10)["items"]
    assert [(x["commit"], x["answer"]) for x in r] == [(SHA, "not_met"), (SHA2, "met")] and r[0]["reason"] == "Export is only planned."
    assert grant.get_grant(0)["milestones"][0]["tries"] == 2

@pytest.mark.parametrize("commit", ["abc123", "g" * 40, "main"])
def test_a_commit_is_a_full_sha(grant, direct_vm, direct_charlie, commit):
    with direct_vm.expect_revert("full 40-hex SHA"):
        claim(direct_vm, grant, direct_charlie, commit=commit)

def test_an_uppercase_sha_is_normalised(grant, direct_vm, direct_charlie):
    claim(direct_vm, grant, direct_charlie, commit="A" * 40)
    assert grant.get_grant(0)["milestones"][0]["commit"] == "a" * 40

def test_a_missing_file_reverts_and_changes_nothing(grant, direct_vm, direct_charlie):
    with direct_vm.expect_revert("unavailable (HTTP 404)"):
        claim(direct_vm, grant, direct_charlie, status=404)
    assert grant.get_grant(0)["milestones"][0]["tries"] == 0 and grant.get_readings(0, 0, 10)["total"] == 0

def test_a_file_too_long_is_refused(grant, direct_vm, direct_charlie):
    with direct_vm.expect_revert("over 60000 characters"):
        claim(direct_vm, grant, direct_charlie, body="x" * 60_001)

def test_no_claim_after_the_deadline_and_anyone_reclaims(grant, direct_vm, direct_alice, direct_charlie, ledger):
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("open until"):
        grant.reclaim(0, 0)
    tick(direct_vm, 31 * DAY)
    with direct_vm.expect_revert("the deadline was"):
        claim(direct_vm, grant, direct_charlie)
    direct_vm.sender = direct_charlie
    assert grant.reclaim(0, 0) == PART and ledger.paid_to(direct_alice) == PART
    with direct_vm.expect_revert("milestone is RECLAIMED"):
        grant.reclaim(0, 0)
    assert grant.get_grant(0)["milestones"][1]["status"] == "OPEN"

def test_unknown_milestone(grant, direct_vm, direct_charlie):
    with direct_vm.expect_revert("milestone not found"):
        claim(direct_vm, grant, direct_charlie, ms=2)

def test_a_payout_needs_the_balance(grant, direct_vm, direct_charlie):
    chain_balance(direct_vm, 0)
    with direct_vm.expect_revert("balance below payout"):
        claim(direct_vm, grant, direct_charlie)
    assert grant.get_grant(0)["milestones"][0]["status"] == "OPEN"

def test_validators_agree_on_the_answer(grant, direct_vm, direct_charlie):
    claim(direct_vm, grant, direct_charlie)
    assert direct_vm.run_validator()
    assert not direct_vm.run_validator(leader_result={"answer": "not_met", "quote": "", "reason": "x"})

def test_the_quote_must_be_in_each_validators_copy(grant, direct_vm, direct_charlie):
    claim(direct_vm, grant, direct_charlie)
    assert not direct_vm.run_validator(leader_result={"answer": "met", "quote": "Added a full REST API.", "reason": "x"})

def test_a_quote_not_in_the_file_is_an_llm_error(grant, direct_vm, direct_charlie):
    with direct_vm.expect_revert("quote is not in the file"):
        claim(direct_vm, grant, direct_charlie, quote="Added a full REST API with auth.")

def test_a_missing_file_is_agreed(grant, direct_vm, direct_charlie):
    claim(direct_vm, grant, direct_charlie, **NOT_MET)
    page(direct_vm, status=404)  # validators now see the file missing
    assert direct_vm.run_validator(leader_error="[EXTERNAL] page unavailable (HTTP 404)") is True
    assert direct_vm.run_validator(leader_error="[EXTERNAL] page unavailable (HTTP 503)") is False
    assert direct_vm.run_validator() is False

def test_delivered_milestone_settles(grant, direct_vm, direct_charlie, chain):
    claim(direct_vm, grant, direct_charlie)
    tx, fin = chain.pay(grant, 0, "claim", [0, 0, SHA])
    assert grant.settle_payout(0, tx, fin) == "DELIVERED"
    with direct_vm.expect_revert("already settled"):
        grant.settle_payout(0, tx, fin)

def test_failed_milestone_is_recoverable_by_the_grantee(grant, direct_vm, direct_bob, direct_charlie, chain, ledger):
    claim(direct_vm, grant, direct_charlie)
    tx, fin = chain.pay(grant, 0, "claim", [0, 0, SHA], delivered=False)
    assert grant.settle_payout(0, tx, fin) == "FAILED" and grant.get_recoverable(to_hex(direct_bob)) == PART
    direct_vm.sender = direct_bob
    tick(direct_vm)
    assert grant.recover(OTHER) == PART and ledger.paid_to(OTHER) == PART

@pytest.mark.parametrize("kw", [{"sender": OTHER}, {"at": 1}, {"status": 5}, {"result": 2}, {"delivered": None}, {"method": "reclaim"}, {"args": [1, 0, SHA]}])
def test_settle_rejects_a_transaction_that_is_not_this_payout(kw, grant, direct_vm, direct_charlie, chain):
    claim(direct_vm, grant, direct_charlie)
    method, a = kw.pop("method", "claim"), kw.pop("args", [0, 0, SHA])
    tx, fin = chain.pay(grant, 0, method, a, **{"delivered": False, **kw})
    with direct_vm.expect_revert():
        grant.settle_payout(0, tx, fin)
