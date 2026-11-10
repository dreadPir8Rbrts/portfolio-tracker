import { test } from "node:test";
import assert from "node:assert/strict";
import { gradingSchema, prepareGrading } from "../lib/grading";
import { balances } from "../lib/ledger";
import { gradingFixture } from "./grading-fixtures";

test("submission metadata creates no payment; completion needs a grade and valid date", () => {
  const { submission, data } = gradingFixture();
  assert.equal(
    prepareGrading({ submission, expected_version: 0 }, data).expense,
    undefined,
  );
  assert.throws(
    () => gradingSchema.parse({ ...submission, status: "completed" }),
    /completion date/,
  );
  assert.throws(
    () => gradingSchema.parse({ ...submission, date_completed: "2025-12-01" }),
    /precede/,
  );
  assert.throws(
    () =>
      gradingSchema.parse({
        ...submission,
        grading_costs_paid_on: "2026-01-03",
      }),
    /Paid costs/,
  );
  assert.equal(
    gradingSchema.parse({ ...submission, final_grading_costs: 0 })
      .final_grading_costs,
    0,
  );
});
test("paid expense defaults to ownership and changes debt once; existing link creates no new payment", () => {
  const { paid, expense, data } = gradingFixture();
  const prepared = prepareGrading(
    { submission: paid, expense, expected_version: 0 },
    data,
  );
  assert.equal(prepared.expense?.allocations, undefined);
  const after = { ...data, events: [prepared.expense!] };
  assert.equal(
    balances(data.deals, after.events)[0].amount -
      balances(data.deals, [])[0].amount,
    500,
  );
  assert.equal(
    prepareGrading({ submission: paid, expected_version: 0 }, after).expense,
    undefined,
  );
  const michael = { ...expense, from: "1of1" as const };
  const p = prepareGrading(
    {
      submission: { ...paid, grading_costs_paid_by: "1of1" },
      expense: michael,
      expected_version: 0,
    },
    data,
  );
  assert.equal(balances(data.deals, [p.expense!])[0].amount, 4500);
});
test("custom splits persist and duplicate links, stale edits, financial edits and nonadmins are rejected", () => {
  const { paid, expense, data } = gradingFixture();
  const custom = {
    ...expense,
    allocations: [
      { person: "dread" as const, weight: 3 },
      { person: "1of1" as const, weight: 1 },
    ],
  };
  const p = prepareGrading(
    { submission: paid, expense: custom, expected_version: 0 },
    data,
  );
  assert.equal(balances(data.deals, [p.expense!])[0].amount, 5250);
  const updated = {
    ...data,
    events: [p.expense!],
    grading: [{ ...paid, version: 1 }],
  };
  assert.throws(
    () => prepareGrading({ submission: paid, expected_version: 0 }, updated),
    /changed/,
  );
  assert.throws(
    () =>
      prepareGrading(
        {
          submission: { ...paid, final_grading_costs: 2000 },
          expected_version: 1,
        },
        updated,
      ),
    /Reverse/,
  );
  assert.throws(
    () =>
      prepareGrading(
        {
          submission: { ...paid, id: crypto.randomUUID() },
          expected_version: 0,
        },
        updated,
      ),
    /already linked/,
  );
  assert.throws(
    () =>
      prepareGrading(
        { submission: paid, expected_version: 0 },
        { ...data, admin: false },
      ),
    /Admin/,
  );
});
test("reversed costs can be reconciled without retaining a false paid state", () => {
  const { paid, expense, data } = gradingFixture();
  const reversal = {
    ...expense,
    id: crypto.randomUUID(),
    kind: "void" as const,
    target: expense.id,
    amount: 0,
  };
  const current = {
    ...data,
    events: [expense, reversal],
    grading: [{ ...paid, version: 1 }],
  };
  assert.throws(
    () => prepareGrading({ submission: paid, expected_version: 1 }, current),
    /active expense/,
  );
  const unpaid = {
    ...paid,
    grading_costs_paid_by: null,
    grading_costs_paid_on: null,
    expense_entry_id: null,
  };
  assert.equal(
    prepareGrading({ submission: unpaid, expected_version: 1 }, current)
      .expense,
    undefined,
  );
});
