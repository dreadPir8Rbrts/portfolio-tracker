import { Data, Entry, PersonId, ids } from "./model";
import { activeEntries, allocate } from "./ledger";
import { balanceStatement } from "./balance-statement";

export const sourceCategories = {
  shared_payout: "Shared payout",
  personal_payout: "Personal payout",
  pass_through: "Pass-through payout",
  refund: "Refund",
  purchase: "Purchase / expense",
  forwarded: "Forwarded payout funds",
} as const;
export const payoutCategories = [
  "shared_payout",
  "personal_payout",
  "pass_through",
];
export function sourceOptions(kind: Entry["kind"], members: number) {
  if (kind === "sale")
    return [members > 1 ? "shared_payout" : "personal_payout"] as const;
  if (kind === "payment")
    return ["personal_payout", "pass_through", "refund"] as const;
  if (kind === "on_behalf") return ["forwarded", "purchase"] as const;
  if (kind === "purchase_funding" || kind === "expense")
    return ["purchase"] as const;
  return [];
}

export function ebayPayouts(
  data: Pick<Data, "deals" | "events">,
  person: PersonId,
) {
  const active = activeEntries(data.events);
  const relevant = (e: Entry) =>
    e.dealId
      ? data.deals
          .find((d) => d.id === e.dealId)
          ?.members.some((m) => m.person === person)
      : e.from === person || e.to === person;
  const candidates = active.filter(
    (e) =>
      e.source === "ebay" &&
      payoutCategories.includes(e.sourceCategory ?? "") &&
      e.amount > 0 &&
      relevant(e),
  );
  const changes = new Map<PersonId, Map<string, number>>();
  for (const partner of ids.filter((p) => p !== person)) {
    changes.set(
      partner,
      new Map(
        balanceStatement(data.deals, data.events, person, partner).rows.map(
          (r) => [r.id, r.change],
        ),
      ),
    );
  }
  const rows = candidates
    .map((entry) => {
      const deal = data.deals.find((d) => d.id === entry.dealId);
      const amount = entry.amount - entry.fees;
      const shares = deal ? allocate(amount, deal.members) : null;
      const linked = active.filter(
        (e) => e.sourceCategory === "forwarded" && e.payoutEntryId === entry.id,
      );
      const partners = ids.filter(
        (p) =>
          p !== person &&
          (deal
            ? deal.members.some((m) => m.person === p)
            : p === entry.from || p === entry.to),
      );
      const effects = partners.map((partner) => ({
        partner,
        receipt: changes.get(partner)?.get(entry.id) ?? 0,
        forwarded: linked.reduce(
          (n, e) => n + (changes.get(partner)?.get(e.id) ?? 0),
          0,
        ),
      }));
      return {
        entry,
        deal,
        amount,
        shares,
        partners,
        linked,
        effects,
        receivedBy: entry.kind === "sale" ? entry.from : entry.to!,
        share:
          entry.sourceCategory === "pass_through"
            ? null
            : shares
              ? shares[person]
              : entry.from === person
                ? amount
                : 0,
        group: entry.payoutGroup ?? entry.id,
      };
    })
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date));
  return {
    rows,
    refunds: active.filter(
      (e) =>
        e.source === "ebay" && e.sourceCategory === "refund" && relevant(e),
    ),
  };
}

export function summarizePayouts(rows: ReturnType<typeof ebayPayouts>["rows"]) {
  const sum = (category?: Entry["sourceCategory"]) =>
    rows
      .filter((r) => !category || r.entry.sourceCategory === category)
      .reduce((n, r) => n + r.amount, 0);
  return {
    total: sum(),
    shared: sum("shared_payout"),
    personal: sum("personal_payout"),
    passThrough: sum("pass_through"),
    sharedShare: rows
      .filter((r) => r.entry.sourceCategory === "shared_payout")
      .reduce((n, r) => n + (r.share ?? 0), 0),
    count: new Set(rows.map((r) => r.group)).size,
  };
}
