import { balances } from "./ledger";
import { kindNames } from "./labels";
import { Deal, Entry, PersonId, people, money } from "./model";

export type StatementRow = {
  id: string;
  date: string;
  title: string;
  explanation: string;
  notes: string;
  dealId?: string;
  change: number;
  balance: number;
};

/** Positive means person owes partner; negative means partner owes person. */
export function pairBalance(
  deals: Deal[],
  events: Entry[],
  person: PersonId,
  partner: PersonId,
) {
  return balances(deals, events).reduce(
    (sum, edge) =>
      sum +
      (edge.from === person && edge.to === partner
        ? edge.amount
        : edge.from === partner && edge.to === person
          ? -edge.amount
          : 0),
    0,
  );
}

function describe(entry: Entry, events: Entry[]): string {
  const actor = people[entry.from];
  const recipient = entry.to ? people[entry.to] : "";
  switch (entry.kind) {
    case "purchase_funding":
      return `${actor} funded ${money(entry.amount)} of the purchase.`;
    case "expense":
      return `${actor} paid a ${money(entry.amount)} expense, allocated ${entry.allocations ? "using its recorded custom split" : "by deal ownership"}.`;
    case "sale":
      return `${actor} received ${money(entry.amount)} in sale proceeds${entry.fees ? `, less ${money(entry.fees)} in fees` : ""}.`;
    case "credit_sale":
      return `${actor} sold to ${recipient} on credit for ${money(entry.amount)}; this is a receivable, not a cash receipt.`;
    case "payment":
      return `${actor} paid ${recipient} ${money(entry.amount)}.`;
    case "on_behalf":
      return `${actor} paid ${money(entry.amount)} on behalf of ${recipient}.`;
    case "purchase_obligation":
      return `${actor} owes ${recipient} ${money(entry.amount)} for a purchase on credit.`;
    case "distribution":
      return `${actor} paid ${recipient} ${money(entry.amount)} from the deal.`;
    case "funding_repayment":
      return `${actor} reimbursed ${recipient} ${money(entry.amount)} of deal funding.`;
    case "void": {
      const target = events.find((e) => e.id === entry.target);
      return target
        ? `Reverses ${kindNames[target.kind].toLowerCase()} of ${money(target.amount)} dated ${target.date}.`
        : "Reverses an earlier transaction.";
    }
    default:
      return `${kindNames[entry.kind]} of ${money(entry.amount)}.`;
  }
}

/** Restated effective-date history, using current corrected deal projections.
 * Input event order is the server's recorded sequence and breaks same-day ties.
 * Never use journal postings: they reflect insertion-time, not effective-date deltas.
 */
export function balanceStatement(
  deals: Deal[],
  events: Entry[],
  person: PersonId,
  partner: PersonId,
) {
  const steps: { date: string; order: number; deal?: Deal; event?: Entry }[] =
    deals.map((deal, i) => ({
      // Tracked funding can legitimately precede the acquisition date.
      date:
        deal.fundingMode === "payments"
          ? events
              .filter((e) => e.dealId === deal.id)
              .reduce(
                (date, e) => (e.date < date ? e.date : date),
                deal.acquired,
              )
          : deal.acquired,
      order: i - deals.length,
      deal,
    }));
  events.forEach((event, order) =>
    steps.push({ date: event.date, order, event }),
  );
  steps.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const includedDeals: Deal[] = [],
    includedEvents: Entry[] = [],
    rows: StatementRow[] = [];
  let previous = 0;
  for (const step of steps) {
    if (step.deal) includedDeals.push(step.deal);
    if (step.event) includedEvents.push(step.event);
    const balance = pairBalance(includedDeals, includedEvents, person, partner);
    const change = balance - previous;
    previous = balance;
    if (!change) continue;
    const event = step.event;
    const linkedId = step.deal?.id ?? event?.dealId ?? event?.acquisitionId;
    const deal = deals.find((d) => d.id === linkedId);
    rows.push({
      id: event?.id ?? `acquisition:${step.deal!.id}`,
      date: step.date,
      title: event ? kindNames[event.kind] : "Acquisition funding",
      explanation: event
        ? describe(event, events)
        : step.deal!.fundingMode === "seller_credit"
          ? "Purchase responsibility allocated between the deal owners; the seller payable is recorded separately."
          : "Initial purchase funding allocated between the deal owners.",
      notes: event?.notes ?? step.deal!.notes,
      dealId: deal?.id,
      change,
      balance,
    });
  }
  const current = pairBalance(deals, events, person, partner);
  if (previous !== current)
    throw new Error("Statement does not reconcile with the current balance.");
  return { rows, balance: current };
}
