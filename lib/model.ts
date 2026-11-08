import { z } from "zod";
export const ids = [
  "dread",
  "1of1",
  "mrbodoia",
  "chang",
  "pokemonhooper",
] as const;
export type PersonId = (typeof ids)[number];
export const people: Record<PersonId, string> = {
  dread: "Joey",
  "1of1": "Michael",
  mrbodoia: "Max",
  chang: "Matthew",
  pokemonhooper: "Seb",
};
const person = z.enum(ids);
export const cents = z.number().int().min(0).max(100_000_000_000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Use a valid date",
  );
export const memberSchema = z.object({
  person,
  weight: z.number().int().positive().max(1000000),
  funded: cents,
});
export const inventorySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["lot", "card"]),
  previousInventoryId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(300),
  variant: z.string().max(200).default(""),
  grade: z.string().max(100).default(""),
  certification: z.string().max(100).default(""),
  quantity: z.number().int().positive().max(100000),
  cost: cents,
  notes: z.string().max(5000).default(""),
});
export type Inventory = {
  id: string;
  deal_id: string;
  parent_id: string | null;
  previous_inventory_id?: string | null;
  kind: "lot" | "card";
  name: string;
  variant: string;
  grade: string;
  certification: string;
  quantity: number;
  cost_cents: number;
  notes: string;
};
export const checkpointSchema = z
  .object({
    from_person: person,
    to_person: person,
    as_of: date,
    agreed_cents: cents,
    tolerance_cents: cents,
    notes: z.string().trim().min(1).max(5000),
  })
  .refine((v) => v.from_person !== v.to_person, "Choose different people");
export type Checkpoint = z.infer<typeof checkpointSchema> & { id: string };
export const dealSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    source: z.string().max(200),
    variant: z.string().max(200),
    grade: z.string().max(100),
    acquired: date,
    cost: cents.positive(),
    notes: z.string().max(5000),
    items: z.string().min(1).max(10000),
    members: z.array(memberSchema).min(1).max(5),
    inventory: z.array(inventorySchema).max(1000).optional(),
    fundingMode: z.enum(["payments", "seller_credit"]).optional(),
    seller: person.optional(),
    creditObligor: person.optional(),
    funders: z.array(person).max(5).optional(),
  })
  .superRefine((d, c) => {
    if (
      d.inventory?.length &&
      d.inventory.reduce((n, i) => n + i.cost, 0) !== d.cost
    )
      c.addIssue({
        code: "custom",
        message: "Inventory cost allocation must equal purchase price",
      });
    if (new Set(d.members.map((m) => m.person)).size !== d.members.length)
      c.addIssue({
        code: "custom",
        message: "Each participant must be unique",
      });
    if (d.fundingMode && d.members.some((m) => m.funded !== 0))
      c.addIssue({
        code: "custom",
        message: "Tracked purchases use payment entries, not initial funding",
      });
    if (
      d.fundingMode === "seller_credit" &&
      (!d.seller ||
        d.members.some((m) => m.person === d.seller) ||
        (d.members.length > 1 && !d.creditObligor) ||
        (d.creditObligor !== undefined &&
          !d.members.some((m) => m.person === d.creditObligor)))
    )
      c.addIssue({
        code: "custom",
        message:
          "Seller credit requires a separate seller and an identified responsible buyer",
      });
    if (
      !d.fundingMode &&
      d.members.reduce((s, m) => s + m.funded, 0) !== d.cost
    )
      c.addIssue({
        code: "custom",
        message: "Funding must equal purchase price",
      });
  });
export type Deal = z.infer<typeof dealSchema>;
export const eventSchema = z
  .object({
    id: z.string().uuid(),
    dealId: z.string().uuid().nullable(),
    kind: z.enum([
      "ownership_correction",
      "credit_sale",
      "purchase_funding",
      "purchase_obligation",
      "sale",
      "expense",
      "funding_repayment",
      "distribution",
      "payment",
      "on_behalf",
      "opening",
      "adjustment",
      "void",
    ]),
    date,
    amount: cents,
    fees: cents.default(0),
    from: person,
    to: person.nullable(),
    notes: z.string().trim().min(1).max(5000),
    close: z.boolean().default(false),
    reference: z.string().max(500).optional(),
    source: z.literal("ebay").optional(),
    sourceCategory: z
      .enum([
        "shared_payout",
        "personal_payout",
        "pass_through",
        "refund",
        "purchase",
        "forwarded",
      ])
      .optional(),
    payoutEntryId: z.string().uuid().optional(),
    payoutGroup: z.string().trim().min(1).max(100).optional(),
    saleTerms: z
      .object({
        total: cents.positive(),
        fees: cents,
        // Historical receipts can be linked without rewriting their payloads.
        receiptIds: z.array(z.string().uuid()).max(1000).optional(),
      })
      .optional(),
    saleId: z.string().uuid().optional(),
    acquisitionId: z.string().uuid().optional(),
    revision: z.object({ before: dealSchema, after: dealSchema }).optional(),
    receiptUrl: z.string().url().startsWith("https://").optional(),
    allocations: z
      .array(
        z.object({ person, weight: z.number().int().positive().max(1000000) }),
      )
      .min(1)
      .max(5)
      .optional(),
    soldItems: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          quantity: z.number().int().positive(),
        }),
      )
      .max(1000)
      .optional(),
    target: z.string().uuid().nullable().default(null),
  })
  .superRefine((e, c) => {
    const issue = (message: string) => c.addIssue({ code: "custom", message });
    if (Boolean(e.source) !== Boolean(e.sourceCategory))
      issue("Choose a source and source category together");
    if (e.sourceCategory) {
      const allowed: Record<NonNullable<typeof e.sourceCategory>, string[]> = {
        shared_payout: ["sale"],
        personal_payout: ["sale", "payment"],
        pass_through: ["payment"],
        refund: ["payment"],
        purchase: ["purchase_funding", "expense", "on_behalf"],
        forwarded: ["on_behalf"],
      };
      if (!allowed[e.sourceCategory].includes(e.kind))
        issue("Source category does not match transaction type");
    }
    if ((e.sourceCategory === "forwarded") !== Boolean(e.payoutEntryId))
      issue("Forwarded payments must link to their incoming payout");
    if (
      e.payoutGroup &&
      !["shared_payout", "personal_payout", "pass_through"].includes(
        e.sourceCategory ?? "",
      )
    )
      issue("Only incoming payouts can have a grouping reference");
    if ((e.saleTerms || e.saleId) && e.kind !== "sale")
      issue("Sale terms and installment links apply only to sales");
    if (e.saleTerms && e.saleId) issue("Choose a new sale or an installment");
    if (
      e.saleTerms &&
      (e.saleTerms.fees > e.saleTerms.total ||
        e.amount > e.saleTerms.total ||
        e.fees > e.saleTerms.fees)
    )
      issue("Receipt or fees exceed agreed sale terms");
    if (e.saleId && e.soldItems?.length)
      issue("An installment cannot sell inventory again");
    if (
      e.saleTerms?.receiptIds &&
      (new Set(e.saleTerms.receiptIds).size !== e.saleTerms.receiptIds.length ||
        e.amount !== 0 ||
        e.fees !== 0 ||
        e.soldItems?.length)
    )
      issue(
        "Historical sale terms link existing receipts without new cash or inventory",
      );
    if (
      e.allocations &&
      (e.kind !== "expense" ||
        new Set(e.allocations.map((a) => a.person)).size !==
          e.allocations.length)
    )
      issue("Unique allocations apply only to expenses");
    if (
      e.soldItems?.length &&
      (!["sale", "credit_sale"].includes(e.kind) ||
        new Set(e.soldItems.map((i) => i.itemId)).size !== e.soldItems.length)
    )
      issue("Unique inventory lines apply only to sales");
    if (
      !["void", "ownership_correction"].includes(e.kind) &&
      e.amount <= 0 &&
      !(["sale", "credit_sale"].includes(e.kind) && e.close) &&
      !(e.kind === "sale" && e.saleTerms)
    )
      issue("Amount must be positive (or zero for a final sale)");
    if (["sale", "credit_sale"].includes(e.kind) && e.fees > e.amount)
      issue("Fees cannot exceed proceeds");
    if (!["sale", "credit_sale"].includes(e.kind) && (e.fees !== 0 || e.close))
      issue("Fees and final-sale status apply only to sales");
    if (
      [
        "ownership_correction",
        "credit_sale",
        "purchase_funding",
        "sale",
        "expense",
        "funding_repayment",
        "distribution",
      ].includes(e.kind) &&
      !e.dealId
    )
      issue("Select a deal");
    if (
      [
        "purchase_obligation",
        "payment",
        "on_behalf",
        "opening",
        "adjustment",
      ].includes(e.kind) &&
      e.dealId
    )
      issue("Personal transactions cannot belong to a deal");
    if (
      ![
        "ownership_correction",
        "purchase_funding",
        "sale",
        "expense",
        "void",
      ].includes(e.kind) &&
      (!e.to || e.to === e.from)
    )
      issue("Choose two different people");
    if (e.kind === "purchase_obligation" && !e.acquisitionId)
      issue("Purchase obligation requires its acquisition ID");
    if (e.kind === "purchase_funding" && e.to)
      issue("Purchase funding records the payer; no personal recipient");
    if (e.kind === "credit_sale" && (!e.acquisitionId || !e.soldItems?.length))
      issue("Credit sales require the buyer acquisition and inventory sold");
    if (
      e.kind === "ownership_correction" &&
      (!e.revision || e.amount !== 0 || e.to !== null)
    )
      issue(
        "Ownership correction requires before/after snapshots and no cash amount",
      );
    if (e.kind !== "ownership_correction" && e.revision)
      issue("Revision snapshots apply only to ownership corrections");
    if (e.kind === "void" && !e.target) issue("Choose an entry to reverse");
  });
export type Entry = z.infer<typeof eventSchema>;
export type Data = {
  deals: Deal[];
  events: Entry[];
  person: PersonId;
  admin: boolean;
  inventory?: Inventory[];
  checkpoints?: Checkpoint[];
};
export const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
export function parseMoney(v: FormDataEntryValue | null): number {
  const s = String(v ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw new Error("Enter a positive amount with at most two decimal places");
  const [a, b = ""] = s.split(".");
  return Number(a) * 100 + Number(b.padEnd(2, "0"));
}
