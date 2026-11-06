import { test } from "node:test";
import assert from "node:assert/strict";
import { dealSchema, eventSchema, Entry } from "../lib/model";
import { balances, prepareEntry, validateEntry } from "../lib/ledger";
import { salePerformance } from "../lib/sales";
const first = crypto.randomUUID(),
  second = crypto.randomUUID();
const deal = dealSchema.parse({
  id: crypto.randomUUID(),
  name: "Two PS001s",
  source: "Glitch",
  variant: "",
  grade: "",
  acquired: "2026-09-28",
  cost: 3100000,
  items: "Two cards",
  notes: "",
  members: [
    { person: "dread", weight: 1, funded: 3100000 },
    { person: "1of1", weight: 1, funded: 0 },
  ],
  inventory: [first, second].map((id) => ({
    id,
    name: "PS001",
    kind: "card",
    quantity: 1,
    cost: 1550000,
  })),
});
const entry = (patch: Partial<Entry> = {}) =>
  eventSchema.parse({
    id: crypto.randomUUID(),
    kind: "sale",
    dealId: deal.id,
    date: "2026-10-22",
    amount: 2000000,
    fees: 0,
    from: "dread",
    to: null,
    notes: "Card sale",
    close: false,
    ...patch,
  });
const sale = entry({
  saleTerms: { total: 3000000, fees: 0 },
  soldItems: [{ itemId: first, quantity: 1 }],
});
const receipt = entry({ date: "2026-10-26", amount: 1000000, saleId: sale.id });
test("sale-date profit is independent of installments and deal closure", () => {
  const history = [sale, receipt];
  const then = salePerformance(deal, history, undefined, "2026-10-22");
  assert.equal(then.profit, 1450000);
  assert.equal(then.received, 2000000);
  assert.equal(then.owed, 1000000);
  assert.equal(then.shares.dread, 725000);
  assert.equal(then.shares["1of1"], 725000);
  const now = salePerformance(deal, history);
  assert.equal(now.profit, 1450000);
  assert.equal(now.owed, 0);
  assert.equal(
    salePerformance(deal, history, undefined, "2026-10-21").profit,
    0,
  );
  assert.deepEqual(
    balances([deal], history),
    balances(
      [deal],
      history.map(({ saleTerms, saleId, ...e }) => e),
    ),
  );
});
test("unpaid sale and partial loss recognize cost immediately", () => {
  const unpaid = entry({
    amount: 0,
    saleTerms: { total: 1000000, fees: 0 },
    soldItems: sale.soldItems,
  });
  assert.equal(salePerformance(deal, [unpaid]).profit, -550000);
  assert.equal(salePerformance(deal, [unpaid]).owed, 1000000);
  assert.deepEqual(prepareEntry(unpaid, [deal], [])._postings, []);
});
test("invalid links, overpayments, early receipts and premature closure are rejected", () => {
  assert.throws(
    () => validateEntry({ ...receipt, amount: 1000001 }, [deal], [sale]),
    /exceed/,
  );
  assert.throws(
    () => validateEntry({ ...receipt, date: "2026-10-21" }, [deal], [sale]),
    /on or before/,
  );
  assert.throws(
    () =>
      validateEntry(
        { ...receipt, saleId: crypto.randomUUID() },
        [deal],
        [sale],
      ),
    /active sale/,
  );
  assert.throws(
    () => validateEntry({ ...sale, close: true }, [deal], []),
    /Keep the deal open/,
  );
  assert.equal(
    eventSchema.safeParse({ ...receipt, soldItems: sale.soldItems }).success,
    false,
  );
});
test("historical linking preserves cash, inventory and receipt dates", () => {
  const oldSale = entry({ soldItems: sale.soldItems }),
    oldReceipt = entry({ date: "2026-10-26", amount: 1000000 });
  const annotation = entry({
    amount: 0,
    saleTerms: {
      total: 3000000,
      fees: 0,
      receiptIds: [oldSale.id, oldReceipt.id],
    },
  });
  const history = [oldSale, oldReceipt];
  const prepared = prepareEntry(annotation, [deal], history);
  assert.deepEqual(prepared._postings, []);
  assert.equal(prepared.soldItems, undefined);
  const result = salePerformance(
    deal,
    [...history, annotation],
    undefined,
    "2026-10-22",
  );
  assert.equal(result.profit, 1450000);
  assert.equal(result.owed, 1000000);
  assert.throws(
    () =>
      validateEntry(
        { ...annotation, id: crypto.randomUUID() },
        [deal],
        [...history, annotation],
      ),
    /already linked/,
  );
});
test("unknown receipts show incomplete P/L and unknown buyer balance", () => {
  const result = salePerformance(deal, [entry()]);
  assert.equal(result.incomplete, 1);
  assert.equal(result.rows[0].profit, null);
  assert.equal(result.rows[0].owed, null);
});
test("shared expenses and custom owner splits conserve cents", () => {
  const expense = entry({
    kind: "expense",
    amount: 101,
    date: "2026-10-01",
    allocations: [{ person: "1of1", weight: 1 }],
  });
  const sale2 = entry({
    date: "2026-10-27",
    amount: 1000000,
    saleTerms: { total: 1000000, fees: 0 },
    soldItems: [{ itemId: second, quantity: 1 }],
  });
  const result = salePerformance(deal, [expense, sale, receipt, sale2]);
  assert.equal(result.profit, 899899);
  assert.equal(
    Object.values(result.shares).reduce((a, b) => a + b, 0),
    result.profit,
  );
  for (const row of result.rows)
    assert.equal(
      Object.values(row.shares).reduce((a, b) => a + b, 0),
      row.profit,
    );
  assert.equal(
    result.rows.reduce((n, r) => n + r.cost!, 0),
    3100101,
  );
});
test("reversing installments restores owed amount; reversing the sale leaves no phantom P/L", () => {
  const reversed = entry({ kind: "void", amount: 0, target: receipt.id });
  assert.equal(salePerformance(deal, [sale, receipt, reversed]).owed, 1000000);
  const reverseSale = entry({ kind: "void", amount: 0, target: sale.id });
  validateEntry(reverseSale, [deal], [sale, receipt, reversed]);
  assert.equal(
    salePerformance(deal, [sale, receipt, reversed, reverseSale]).profit,
    0,
  );
});

test("internal credit transfers do not pretend unallocated partner payments are unpaid", () => {
  const transfer = {
    ...sale,
    kind: "credit_sale" as const,
    saleTerms: undefined,
    amount: 3000000,
    acquisitionId: crypto.randomUUID(),
    to: "chang" as const,
  };
  const result = salePerformance(deal, [transfer]);
  assert.equal(result.profit, 1450000);
  assert.equal(result.rows[0].received, null);
  assert.equal(result.rows[0].owed, null);
});

test("final installment cannot silently sell the remaining inventory", () => {
  assert.throws(
    () => prepareEntry({ ...receipt, close: true }, [deal], [sale]),
    /unsold inventory/,
  );
});
