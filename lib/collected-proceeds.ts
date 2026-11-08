import { Deal, Entry, ids } from "./model";
import { activeEntries, allocate, zero } from "./ledger";

// Ownership share of collected cash, independent of profit or who collected it.
// Allocate each receipt separately, matching the existing payout rounding rules.
export function collectedProceeds(deals: Deal[], events: Entry[]) {
  const shares = zero();
  const byId = new Map(deals.map((deal) => [deal.id, deal]));
  let total = 0;
  const rows: {
    receipt: Entry;
    deal: Deal;
    net: number;
    shares: ReturnType<typeof zero>;
  }[] = [];
  for (const receipt of activeEntries(events).sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (receipt.kind !== "sale" || !receipt.dealId) continue;
    const deal = byId.get(receipt.dealId);
    if (!deal) continue;
    const net = receipt.amount - receipt.fees;
    const allocation = allocate(net, deal.members);
    total += net;
    for (const person of ids) shares[person] += allocation[person];
    if (receipt.amount > 0)
      rows.push({ receipt, deal, net, shares: allocation });
  }
  return { total, shares, rows };
}
