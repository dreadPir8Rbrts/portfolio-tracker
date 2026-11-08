import { Data, PersonId } from "./model";
import { collectedProceeds } from "./collected-proceeds";
import { salePerformance } from "./sales";

export type MetricKind = "proceeds" | "profit";
export function metricBreakdown(
  data: Pick<Data, "deals" | "events" | "inventory">,
  person?: PersonId,
) {
  const deals = person
    ? data.deals.filter((d) => d.members.some((m) => m.person === person))
    : data.deals;
  const collected = collectedProceeds(deals, data.events);
  let running = 0;
  const receipts = collected.rows.map((row) => {
    const amount = person ? row.shares[person] : row.net;
    running += amount;
    return { ...row, amount, running };
  });
  running = 0;
  const sales = deals
    .flatMap((deal) =>
      salePerformance(deal, data.events, data.inventory).rows.map((sale) => ({
        deal,
        sale,
      })),
    )
    .sort((a, b) => a.sale.date.localeCompare(b.sale.date))
    .map((row) => {
      const amount =
        row.sale.profit === null
          ? null
          : person
            ? row.sale.shares[person]
            : row.sale.profit;
      running += amount ?? 0;
      const ids = new Set([row.sale.id, ...row.sale.receiptIds]);
      const notes = data.events.filter((e) => ids.has(e.id));
      return { ...row, amount, running, notes };
    });
  return {
    receipts,
    sales,
    proceeds: person ? collected.shares[person] : collected.total,
    profit: running,
    incomplete: sales.filter((r) => r.amount === null).length,
  };
}
