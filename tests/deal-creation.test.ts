import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareDealCreation } from "../lib/deal-creation";
import { project } from "../lib/ledger";
const input = () => {
  const id = crypto.randomUUID();
  return {
    id,
    name: "Collection pickup",
    source: "Seller",
    variant: "",
    grade: "",
    acquired: "2026-10-30",
    cost: 2500000,
    notes: "",
    items: "Cards",
    members: [
      { person: "dread", weight: 1, funded: 2500000 },
      { person: "1of1", weight: 1, funded: 0 },
    ],
    expenses: [
      {
        id: crypto.randomUUID(),
        dealId: id,
        kind: "expense",
        date: "2026-10-29",
        amount: 50000,
        from: "dread",
        to: null,
        notes: "Flights",
      },
      {
        id: crypto.randomUUID(),
        dealId: id,
        kind: "expense",
        date: "2026-10-30",
        amount: 20000,
        from: "1of1",
        to: null,
        notes: "Hotel",
        allocations: [{ person: "1of1", weight: 1 }],
      },
    ],
  };
};
test("new-deal expenses use ownership by default, custom splits, and their actual payers", () => {
  const { deal, entries } = prepareDealCreation(input(), [], []);
  const state = project(deal, entries);
  assert.equal(deal.cost, 2500000);
  assert.equal(state.cost, 2570000);
  assert.equal(state.positions.dread, 1275000);
  assert.equal(state.positions["1of1"], -1275000);
  assert.equal(state.costShares["1of1"], 1295000);
  assert.equal(entries.length, 2);
  assert.ok(
    entries.every((e) => e._postings.reduce((n, p) => n + p.amount, 0) === 0),
  );
});
test("new-deal expenses reject wrong deals, types, duplicate IDs and invalid allocations", () => {
  const a = input();
  a.expenses[1].dealId = crypto.randomUUID();
  assert.throws(() => prepareDealCreation(a, [], []), /this deal/);
  const b = input();
  b.expenses[0].kind = "payment";
  assert.throws(() => prepareDealCreation(b, [], []));
  const c = input();
  c.expenses[1].id = c.expenses[0].id;
  assert.throws(() => prepareDealCreation(c, [], []), /already recorded/);
  const d = input();
  d.expenses[1].allocations = [{ person: "chang", weight: 1 }];
  assert.throws(() => prepareDealCreation(d, [], []), /participants/);
  const e = input();
  e.expenses[0].notes = " ";
  assert.throws(() => prepareDealCreation(e, [], []));
  const f = input();
  f.expenses[1].allocations = [];
  assert.throws(() => prepareDealCreation(f, [], []));
});
