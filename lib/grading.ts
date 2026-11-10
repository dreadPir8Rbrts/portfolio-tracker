import { z } from "zod";
import { cents, date, ids, eventSchema, Data } from "./model";
import { activeEntries, prepareEntry, validateEntry } from "./ledger";

export const gradingStatuses = [
  "submitted",
  "grading",
  "completed",
  "returned",
  "cancelled",
] as const;
export const gradingSchema = z
  .object({
    id: z.string().uuid(),
    deal_id: z.string().uuid(),
    card_name: z.string().trim().min(1).max(300),
    inventory_item_id: z.string().uuid().nullable().default(null),
    submitted_by: z.enum(ids),
    grading_company: z.string().trim().min(1).max(100),
    submission_tier: z.string().trim().max(100).default(""),
    date_submitted: date,
    date_completed: date.nullable().default(null),
    final_grade: z.string().trim().min(1).max(100).nullable().default(null),
    final_grading_costs: cents.nullable().default(null),
    grading_costs_paid_by: z.enum(ids).nullable().default(null),
    grading_costs_paid_on: date.nullable().default(null),
    expense_entry_id: z.string().uuid().nullable().default(null),
    status: z.enum(gradingStatuses).default("submitted"),
    submission_reference: z.string().trim().max(200).default(""),
    certification_number: z.string().trim().max(200).default(""),
    notes: z.string().max(5000).default(""),
  })
  .superRefine((s, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (s.date_completed && s.date_completed < s.date_submitted)
      issue("Completion cannot precede submission");
    if (
      ["completed", "returned"].includes(s.status) &&
      (!s.date_completed || !s.final_grade)
    )
      issue(
        "Completed or returned submissions need a completion date and final grade",
      );
    const paid = [
      s.grading_costs_paid_by,
      s.grading_costs_paid_on,
      s.expense_entry_id,
    ];
    if (paid.some(Boolean) && (!paid.every(Boolean) || !s.final_grading_costs))
      issue(
        "Paid costs need a positive amount, payer, payment date and linked expense",
      );
  });
export type Grading = z.infer<typeof gradingSchema> & {
  version: number;
  created_at?: string;
  updated_at?: string;
};
export const gradingRequestSchema = z.object({
  submission: gradingSchema,
  expected_version: z.number().int().min(0),
  expense: eventSchema.optional(),
});
export type GradingRequest = z.infer<typeof gradingRequestSchema>;

export function prepareGrading(raw: unknown, data: Data) {
  if (!data.admin) throw new Error("Admin access required");
  const request = gradingRequestSchema.parse(raw);
  const s = request.submission;
  const existing = data.grading?.find((g) => g.id === s.id);
  if ((existing?.version ?? 0) !== request.expected_version)
    throw new Error("Submission changed. Refresh and try again.");
  if (existing && existing.deal_id !== s.deal_id)
    throw new Error("A submission cannot be moved to another deal");
  if (!data.deals.some((d) => d.id === s.deal_id))
    throw new Error("Deal not found");
  if (
    s.inventory_item_id &&
    !data.inventory?.some(
      (i) =>
        i.id === s.inventory_item_id &&
        i.deal_id === s.deal_id &&
        i.kind === "card",
    )
  )
    throw new Error(
      "Choose a card from this deal or leave the inventory link empty",
    );
  const active = activeEntries(data.events);
  if (
    existing?.expense_entry_id &&
    active.some((e) => e.id === existing.expense_entry_id)
  ) {
    for (const key of [
      "expense_entry_id",
      "final_grading_costs",
      "grading_costs_paid_by",
      "grading_costs_paid_on",
    ] as const)
      if (existing[key] !== s[key])
        throw new Error(
          "Reverse the original expense before changing recorded payment details",
        );
  }
  let expense;
  if (request.expense) {
    const e = request.expense;
    if (
      e.id !== s.expense_entry_id ||
      e.kind !== "expense" ||
      e.dealId !== s.deal_id
    )
      throw new Error(
        "Grading payment must be an expense for this submission's deal",
      );
    validateEntry(e, data.deals, data.events);
    expense = prepareEntry(e, data.deals, data.events, data.inventory);
  }
  if (s.expense_entry_id) {
    const e = expense ?? active.find((e) => e.id === s.expense_entry_id);
    if (
      !e ||
      e.kind !== "expense" ||
      e.dealId !== s.deal_id ||
      e.from !== s.grading_costs_paid_by ||
      e.date !== s.grading_costs_paid_on ||
      e.amount !== s.final_grading_costs
    )
      throw new Error(
        "Payment details must match an active expense for this deal",
      );
    if (
      data.grading?.some(
        (g) => g.id !== s.id && g.expense_entry_id === s.expense_entry_id,
      )
    )
      throw new Error("This expense is already linked to another submission");
  }
  return { submission: s, expense, expected_version: request.expected_version };
}
