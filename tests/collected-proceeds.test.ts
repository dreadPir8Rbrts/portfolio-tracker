import { test } from "node:test";
import assert from "node:assert/strict";
import { collectedProceeds } from "../lib/collected-proceeds";
import { dealSchema, eventSchema, Entry } from "../lib/model";
const deal = dealSchema.parse({
  id: crypto.randomUUID(),
  name: "Example cards",
  source: "Example",
  variant: "",
  grade: "",
  acquired: "2026-01-01",
  cost: 1000000,
  items: "Cards",
  notes: "",
  members: [
    { person: "dread", weight: 1, funded: 1000000 },
    { person: "1of1", weight: 1, funded: 0 },
  ],
});
const receipt = (patch: Partial<Entry> = {}) =>
  eventSchema.parse({
    id: crypto.randomUUID(),
    kind: "sale",
    dealId: deal.id,
    date: "2026-01-02",
    amount: 3000000,
    from: "dread",
    to: null,
    notes: "Example receipt",
    ...patch,
  });
test("collected proceeds use ownership, regardless of collector or funding, without deducting cost", () => {
  assert.equal(collectedProceeds([deal], [receipt()]).shares["1of1"], 1500000);
  assert.equal(
    collectedProceeds([deal], [receipt({ from: "1of1", fees: 100000 })]).shares[
      "1of1"
    ],
    1450000,
  );
});
test("pending sales contribute zero; installments and historical links count each receipt once", () => {
  const pending = receipt({
    amount: 0,
    saleTerms: { total: 3000000, fees: 100000 },
  });
  assert.equal(collectedProceeds([deal], [pending]).total, 0);
  const partial = receipt({ amount: 1000000, fees: 0, saleId: pending.id });
  assert.equal(
    collectedProceeds([deal], [pending, partial]).shares["1of1"],
    500000,
  );
  const old = receipt({ amount: 900000 });
  const link = receipt({
    amount: 0,
    saleTerms: { total: 900000, fees: 0, receiptIds: [old.id] },
  });
  assert.equal(collectedProceeds([deal], [old, link]).total, 900000);
});
test("reversals, credit sales, personal payments, pass-throughs, and unrelated deals are excluded", () => {
  const sold = receipt();
  const reversed = receipt({ kind: "void", target: sold.id, amount: 0 });
  const payment = receipt({
    kind: "payment",
    dealId: null,
    from: "1of1",
    to: "dread",
  });
  const pass = receipt({
    kind: "payment",
    dealId: null,
    from: "1of1",
    to: "dread",
    source: "ebay",
    sourceCategory: "pass_through",
  });
  // This metric considers cash sale receipts only, not internal credit transfers.
  const credit = {
    ...sold,
    id: crypto.randomUUID(),
    kind: "credit_sale" as const,
    to: "chang" as const,
  };
  assert.equal(
    collectedProceeds(
      [deal],
      [
        sold,
        reversed,
        payment,
        pass,
        credit,
        receipt({ dealId: crypto.randomUUID() }),
      ],
    ).total,
    0,
  );
});
test("allocation conserves cents per receipt across three owners and already-net payouts", () => {
  const thirds = {
    ...deal,
    members: [
      { person: "dread" as const, weight: 1, funded: 1000000 },
      { person: "1of1" as const, weight: 1, funded: 0 },
      { person: "chang" as const, weight: 1, funded: 0 },
    ],
  };
  const result = collectedProceeds(
    [thirds],
    [receipt({ amount: 101 }), receipt({ amount: 101 })],
  );
  assert.equal(result.total, 202);
  assert.equal(result.shares.dread, 68);
  assert.equal(result.shares["1of1"], 68);
  assert.equal(result.shares.chang, 66);
  assert.equal(
    Object.values(result.shares).reduce((n, v) => n + v, 0),
    result.total,
  );
  assert.equal(result.shares.mrbodoia, 0);
});
