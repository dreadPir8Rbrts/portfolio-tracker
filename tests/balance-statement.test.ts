import { test } from "node:test";
import assert from "node:assert/strict";
import { dealSchema, eventSchema, Deal, Entry } from "../lib/model";
import { balanceStatement, pairBalance } from "../lib/balance-statement";

const deal = (patch: Partial<Deal> = {}) =>
  dealSchema.parse({
    id: crypto.randomUUID(),
    name: "Example collection",
    source: "Example seller",
    variant: "",
    grade: "raw",
    acquired: "2026-01-02",
    cost: 10000,
    items: "Two cards",
    notes: "Example purchase",
    fundingMode: "payments",
    members: [
      { person: "dread", weight: 1, funded: 0 },
      { person: "1of1", weight: 1, funded: 0 },
    ],
    ...patch,
  });
const event = (patch: Partial<Entry> = {}) =>
  eventSchema.parse({
    id: crypto.randomUUID(),
    dealId: null,
    kind: "payment",
    date: "2026-01-03",
    amount: 1000,
    from: "1of1",
    to: "dread",
    notes: "Example payment",
    ...patch,
  });
const statement = (deals: Deal[], events: Entry[]) =>
  balanceStatement(deals, events, "1of1", "dread");
const funding = (d: Deal) =>
  event({
    dealId: d.id,
    kind: "purchase_funding",
    from: "dread",
    to: null,
    amount: d.cost,
    date: d.acquired,
  });

test("funding, partial receipts, custom expenses and unpaid sales reconcile in cents", () => {
  const d = deal();
  const entries = [
    funding(d),
    event({
      dealId: d.id,
      kind: "sale",
      from: "dread",
      to: null,
      amount: 3000,
    }),
    event({
      dealId: d.id,
      kind: "expense",
      from: "1of1",
      to: null,
      amount: 201,
      allocations: [
        { person: "dread", weight: 1 },
        { person: "1of1", weight: 2 },
      ],
    }),
    event({
      dealId: d.id,
      kind: "sale",
      from: "dread",
      to: null,
      amount: 0,
      saleTerms: { total: 5000, fees: 0 },
    }),
  ];
  const result = statement([d], entries);
  assert.deepEqual(
    result.rows.map((r) => r.change),
    [5000, -1500, -67],
  );
  assert.equal(result.balance, 3433);
});

test("canceling payments both remain, unrelated payments do not appear, and direction can reverse", () => {
  const a = event(),
    b = event({ kind: "on_behalf", from: "dread", to: "1of1" });
  const unrelated = event({ from: "chang", to: "mrbodoia" });
  const result = statement([], [a, b, unrelated]);
  assert.deepEqual(
    result.rows.map((r) => r.balance),
    [-1000, 0],
  );
  assert.equal(result.balance, 0);
  assert.equal(balanceStatement([], [a], "dread", "1of1").balance, 1000);
});

test("backdated events sort by effective date and recorded order breaks same-day ties", () => {
  const later = event({ date: "2026-01-05" }),
    earlier = event({ date: "2026-01-01" });
  const sameDay = event({ date: "2026-01-01" });
  const result = statement([], [later, earlier, sameDay]);
  assert.deepEqual(
    result.rows.map((r) => r.id),
    [earlier.id, sameDay.id, later.id],
  );
});

test("pre-acquisition funding has one effect, and legacy acquisition funding is included", () => {
  const d = deal();
  const f = { ...funding(d), date: "2026-01-01" };
  assert.deepEqual(
    statement([d], [f]).rows.map((r) => [r.date, r.change]),
    [["2026-01-01", 5000]],
  );
  const legacy = deal({
    fundingMode: undefined,
    members: [
      { person: "dread", weight: 1, funded: 10000 },
      { person: "1of1", weight: 1, funded: 0 },
    ],
  });
  assert.equal(statement([legacy], []).rows[0].change, 5000);
});

test("reversals preserve the original step then undo it on the reversal date", () => {
  const paid = event();
  const reversed = event({
    kind: "void",
    target: paid.id,
    date: "2026-01-04",
    amount: 0,
  });
  const result = statement([], [paid, reversed]);
  assert.deepEqual(
    result.rows.map((r) => r.change),
    [-1000, 1000],
  );
  assert.match(result.rows[1].explanation, /Reverses/);
});

test("seller-credit purchase responsibility and external obligation remain separate", () => {
  const d = deal({
    fundingMode: "seller_credit",
    seller: "1of1",
    creditObligor: "dread",
    members: [
      { person: "dread", weight: 1, funded: 0 },
      { person: "chang", weight: 1, funded: 0 },
    ],
  });
  const obligation = event({
    kind: "purchase_obligation",
    from: "dread",
    to: "1of1",
    amount: d.cost,
    acquisitionId: d.id,
    date: d.acquired,
  });
  assert.equal(statement([d], [obligation]).balance, -10000);
  assert.equal(
    balanceStatement([d], [obligation], "chang", "dread").balance,
    5000,
  );
});

test("corrected ownership is restated from acquisition without counting the correction twice", () => {
  const d = deal({
    fundingMode: undefined,
    members: [
      { person: "dread", weight: 1, funded: 10000 },
      { person: "1of1", weight: 1, funded: 0 },
    ],
  });
  const before = {
    ...d,
    members: [{ person: "dread" as const, weight: 1, funded: 10000 }],
  };
  const correction = event({
    kind: "ownership_correction",
    dealId: d.id,
    from: "dread",
    to: null,
    amount: 0,
    date: d.acquired,
    revision: { before, after: d },
  });
  assert.deepEqual(
    statement([d], [correction]).rows.map((r) => r.change),
    [5000],
  );
});

test("three-way allocation and restricted source data preserve pair totals", () => {
  const d = deal({
    cost: 10001,
    members: [
      { person: "dread", weight: 1, funded: 0 },
      { person: "1of1", weight: 1, funded: 0 },
      { person: "chang", weight: 1, funded: 0 },
    ],
  });
  const entries = [funding(d), event()];
  const result = statement([d], entries);
  assert.equal(result.balance, 2334);
  assert.equal(result.balance, pairBalance([d], entries, "1of1", "dread"));
  assert.deepEqual(statement([], []).rows, []);
});
