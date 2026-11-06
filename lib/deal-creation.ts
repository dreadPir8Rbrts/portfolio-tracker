import { z } from "zod";
import { dealSchema, eventSchema, type Deal, type Entry } from "./model";
import { prepareEntry } from "./ledger";
export type DealCreation = Deal & { expenses?: Entry[] };
const submission = dealSchema.and(
  z.object({ expenses: z.array(eventSchema).max(50).default([]) }),
);
export function prepareDealCreation(
  input: unknown,
  existingDeals: Deal[],
  existingEvents: Entry[],
) {
  const { expenses, ...deal } = submission.parse(input);
  if (deal.fundingMode === "seller_credit")
    throw new Error(
      "Seller-credit purchases must be recorded with their obligation in an atomic import",
    );
  if (existingDeals.some((d) => d.id === deal.id))
    throw new Error("Deal already recorded");
  const history = [...existingEvents];
  const entries = expenses.map((e) => {
    if (e.kind !== "expense" || e.dealId !== deal.id || e.to !== null)
      throw new Error("Additional costs must be expenses for this deal");
    const prepared = prepareEntry(e, [...existingDeals, deal], history);
    history.push(prepared);
    return prepared;
  });
  return { deal, entries };
}
