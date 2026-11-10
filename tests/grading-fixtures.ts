import { Data, dealSchema, eventSchema } from "../lib/model";
import { gradingSchema } from "../lib/grading";
export function gradingFixture() {
  const deal = dealSchema.parse({
    id: crypto.randomUUID(),
    name: "Example collection",
    source: "Example seller",
    variant: "",
    grade: "raw",
    acquired: "2026-01-01",
    cost: 10000,
    items: "Example cards",
    notes: "",
    members: [
      { person: "dread", weight: 1, funded: 10000 },
      { person: "1of1", weight: 1, funded: 0 },
    ],
  });
  const submission = gradingSchema.parse({
    id: crypto.randomUUID(),
    deal_id: deal.id,
    card_name: "Example card",
    submitted_by: "dread",
    grading_company: "PSA",
    submission_tier: "Value",
    date_submitted: "2026-01-02",
  });
  const expense = eventSchema.parse({
    id: crypto.randomUUID(),
    dealId: deal.id,
    kind: "expense",
    date: "2026-01-03",
    from: "dread",
    to: null,
    amount: 1000,
    notes: "Grading cost",
  });
  const paid = {
    ...submission,
    final_grading_costs: expense.amount,
    grading_costs_paid_by: expense.from,
    grading_costs_paid_on: expense.date,
    expense_entry_id: expense.id,
  };
  const data: Data = {
    deals: [deal],
    events: [],
    grading: [],
    person: "dread",
    admin: true,
  };
  return { deal, submission, expense, paid, data };
}
