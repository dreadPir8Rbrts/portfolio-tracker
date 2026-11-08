import { test } from "node:test";
import assert from "node:assert/strict";
import { dealSchema, eventSchema, Entry } from "../lib/model";
import { metricBreakdown } from "../lib/metric-breakdown";
import { salePerformance } from "../lib/sales";
import { collectedProceeds } from "../lib/collected-proceeds";
const item = crypto.randomUUID();
const deal = dealSchema.parse({
  id: crypto.randomUUID(),
  name: "Example pair",
  source: "Example",
  variant: "",
  grade: "",
  acquired: "2026-01-01",
  cost: 10000,
  items: "Two cards",
  notes: "",
  members: [
    { person: "dread", weight: 1, funded: 10000 },
    { person: "1of1", weight: 1, funded: 0 },
  ],
  inventory: [
    { id: item, kind: "card", name: "Example card", quantity: 2, cost: 10000 },
  ],
});
const event = (patch: Partial<Entry> = {}) =>
  eventSchema.parse({
    id: crypto.randomUUID(),
    kind: "sale",
    dealId: deal.id,
    date: "2026-01-02",
    amount: 0,
    from: "dread",
    to: null,
    notes: "Example transaction",
    ...patch,
  });

test("pending sale contributes profit but no proceeds, with custom expenses explained and totals matching cards", () => {
  const expense = event({
    kind: "expense",
    amount: 1000,
    allocations: [
      { person: "dread", weight: 3 },
      { person: "1of1", weight: 1 },
    ],
  });
  const sale = event({
    saleTerms: { total: 8000, fees: 100 },
    soldItems: [{ itemId: item, quantity: 1 }],
  });
  const data = { deals: [deal], events: [expense, sale] };
  const result = metricBreakdown(data, "1of1");
  assert.equal(result.receipts.length, 0);
  assert.equal(result.proceeds, 0);
  assert.equal(result.sales[0].sale.purchaseCost, 5000);
  assert.equal(result.sales[0].sale.expenseCost, 500);
  assert.equal(result.sales[0].sale.expenses[0].shares["1of1"], 125);
  assert.equal(result.sales[0].sale.cost, 5500);
  assert.equal(result.sales[0].sale.received, 0);
  assert.equal(result.sales[0].sale.owed, 8000);
  assert.equal(result.profit, 1325);
  assert.equal(
    result.profit,
    salePerformance(deal, data.events).shares["1of1"],
  );
  assert.equal(result.sales.at(-1)?.running, result.profit);
});

test("installments have separate receipt rows, one sale row, all original notes and correct chronology", () => {
  const sale = event({
    saleTerms: { total: 8000, fees: 100 },
    soldItems: [{ itemId: item, quantity: 1 }],
  });
  const first = event({
    date: "2026-01-04",
    saleId: sale.id,
    amount: 3000,
    fees: 100,
    notes: "First receipt",
  });
  const second = event({
    date: "2026-01-05",
    saleId: sale.id,
    amount: 5000,
    notes: "Final receipt",
  });
  const result = metricBreakdown(
    { deals: [deal], events: [sale, second, first] },
    "1of1",
  );
  assert.deepEqual(
    result.receipts.map((r) => r.receipt.id),
    [first.id, second.id],
  );
  assert.equal(result.sales.length, 1);
  assert.equal(result.sales[0].sale.date, sale.date);
  assert.equal(result.sales[0].sale.received, 8000);
  assert.equal(result.sales[0].sale.owed, 0);
  assert.equal(result.sales[0].notes.length, 3);
  assert.equal(result.proceeds, 3950);
  assert.equal(result.receipts.at(-1)?.running, result.proceeds);
  assert.equal(
    result.proceeds,
    collectedProceeds([deal], [sale, first, second]).shares["1of1"],
  );
});

test("incomplete sale rows stay visible without fabricating profit, including in portfolio totals", () => {
  const unknown = event({ amount: 3000 });
  const result = metricBreakdown({ deals: [deal], events: [unknown] }, "1of1");
  assert.equal(result.incomplete, 1);
  assert.equal(result.sales[0].amount, null);
  assert.equal(result.sales[0].sale.cost, null);
  assert.equal(result.sales[0].sale.total, null);
  assert.equal(result.profit, 0);
  assert.equal(result.sales[0].running, 0);
  assert.equal(result.proceeds, 1500);
  assert.equal(
    metricBreakdown({ deals: [deal], events: [unknown] }).proceeds,
    3000,
  );
});

test("losses, reversals and participant scoping retain card totals", () => {
  const sale = event({
    amount: 2000,
    saleTerms: { total: 2000, fees: 0 },
    soldItems: [{ itemId: item, quantity: 1 }],
  });
  const data = { deals: [deal], events: [sale] };
  assert.equal(metricBreakdown(data, "1of1").profit, -1500);
  assert.equal(metricBreakdown(data, "chang").sales.length, 0);
  assert.equal(metricBreakdown(data, "chang").proceeds, 0);
  const voided = metricBreakdown(
    {
      ...data,
      events: [
        sale,
        event({ kind: "void", target: sale.id, date: "2026-01-03" }),
      ],
    },
    "1of1",
  );
  assert.equal(voided.sales.length, 0);
  assert.equal(voided.receipts.length, 0);
});
