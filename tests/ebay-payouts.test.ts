import { test } from "node:test";
import assert from "node:assert/strict";
import { eventSchema, dealSchema, Entry } from "../lib/model";
import { ebayPayouts, summarizePayouts } from "../lib/ebay-payouts";
import { validateEntry } from "../lib/ledger";
const entry = (patch: Partial<Entry> = {}) =>
  eventSchema.parse({
    id: crypto.randomUUID(),
    dealId: null,
    kind: "payment",
    date: "2026-01-03",
    from: "1of1",
    to: "dread",
    amount: 1000,
    notes: "Synthetic receipt",
    source: "ebay",
    sourceCategory: "personal_payout",
    ...patch,
  });
const deal = dealSchema.parse({
  id: crypto.randomUUID(),
  name: "Example collection",
  source: "Example",
  variant: "",
  grade: "",
  acquired: "2026-01-01",
  cost: 10000,
  items: "Cards",
  notes: "",
  members: [
    { person: "dread", weight: 1, funded: 10000 },
    { person: "1of1", weight: 1, funded: 0 },
  ],
});

test("grouped shared and pass-through allocations count one payout and forwarding never duplicates money", () => {
  const sale = entry({
    kind: "sale",
    dealId: deal.id,
    from: "dread",
    to: null,
    amount: 3001,
    sourceCategory: "shared_payout",
    payoutGroup: "example-deposit",
  });
  const incoming = entry({
    amount: 3000,
    sourceCategory: "pass_through",
    payoutGroup: "example-deposit",
  });
  const outgoing = entry({
    kind: "on_behalf",
    from: "dread",
    to: "1of1",
    amount: 3000,
    sourceCategory: "forwarded",
    payoutEntryId: incoming.id,
    date: "2026-02-01",
  });
  const data = { deals: [deal], events: [sale, incoming, outgoing] };
  const rows = ebayPayouts(data, "1of1").rows;
  assert.deepEqual(summarizePayouts(rows), {
    total: 6001,
    shared: 3001,
    personal: 0,
    passThrough: 3000,
    sharedShare: 1500,
    count: 1,
  });
  const pass = rows.find((r) => r.entry.id === incoming.id)!;
  assert.equal(pass.effects[0].receipt + pass.effects[0].forwarded, 0);
  assert.equal(pass.linked[0].date, "2026-02-01");
  assert.equal(
    summarizePayouts(ebayPayouts(data, "dread").rows).sharedShare,
    1501,
  );
});

test("only explicit payouts count; refunds, purchases, notes, reversals and unrelated payments do not", () => {
  const paid = entry();
  const refund = entry({ sourceCategory: "refund", amount: 2000 });
  const purchase = entry({ kind: "on_behalf", sourceCategory: "purchase" });
  const untagged = entry({
    source: undefined,
    sourceCategory: undefined,
    notes: "ebay payout",
  });
  const unrelated = entry({ from: "chang", to: "mrbodoia" });
  const reversal = entry({
    kind: "void",
    source: undefined,
    sourceCategory: undefined,
    target: paid.id,
    date: "2026-01-04",
    amount: 0,
  });
  const result = ebayPayouts(
    {
      deals: [],
      events: [paid, refund, purchase, untagged, unrelated, reversal],
    },
    "1of1",
  );
  assert.equal(result.rows.length, 0);
  assert.equal(result.refunds.length, 1);
});

test("fees are deducted once and personal receipts belong entirely to the sender", () => {
  const sale = entry({
    kind: "sale",
    dealId: deal.id,
    from: "dread",
    to: null,
    amount: 2000,
    fees: 100,
    sourceCategory: "shared_payout",
  });
  const personal = entry();
  const rows = ebayPayouts(
    { deals: [deal], events: [sale, personal] },
    "1of1",
  ).rows;
  assert.equal(summarizePayouts(rows).total, 2900);
  assert.equal(rows.find((r) => r.entry.id === personal.id)?.share, 1000);
});

test("classification validates kind, linked incoming parties, date, remaining amount and ownership", () => {
  assert.throws(() => entry({ source: undefined }));
  assert.throws(() => entry({ sourceCategory: "purchase" }));
  assert.throws(() => entry({ sourceCategory: "forwarded" }));
  const incoming = entry({ sourceCategory: "pass_through" });
  const out = entry({
    kind: "on_behalf",
    from: "dread",
    to: "1of1",
    sourceCategory: "forwarded",
    payoutEntryId: incoming.id,
  });
  validateEntry(out, [], [incoming]);
  assert.throws(
    () => validateEntry({ ...out, amount: 1001 }, [], [incoming]),
    /exceed/,
  );
  assert.throws(
    () => validateEntry({ ...out, date: "2026-01-01" }, [], [incoming]),
    /earlier/,
  );
  assert.throws(
    () => validateEntry({ ...out, to: "chang" }, [], [incoming]),
    /partners/,
  );
  assert.throws(
    () =>
      validateEntry(
        entry({
          kind: "sale",
          dealId: deal.id,
          from: "dread",
          to: null,
          sourceCategory: "personal_payout",
        }),
        [deal],
        [],
      ),
    /ownership/,
  );
});

test("CSV imports preserve explicit source metadata and never infer it from notes", async () => {
  const { previewImport } = await import("../lib/importer");
  const data = { person: "dread" as const, admin: true, deals: [], events: [] };
  const csv =
    "Type,Date,Amount,From,To,Notes,Source,Source_category\npayment,01-03-2026,10,1of1,dread,Example,ebay,personal_payout";
  const tagged = previewImport(csv, data, "dread");
  assert.equal(tagged.events[0].source, "ebay");
  assert.equal(tagged.events[0].sourceCategory, "personal_payout");
  const untagged = previewImport(
    "Type,Date,Amount,From,To,Notes\npayment,01-03-2026,10,1of1,dread,ebay payout",
    data,
    "dread",
  );
  assert.equal(untagged.events[0].source, undefined);
});
