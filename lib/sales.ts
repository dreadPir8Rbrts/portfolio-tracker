import { Deal, Entry, Inventory, ids } from "./model";
import { activeEntries, allocate, zero } from "./ledger";

// Validate the entire active graph: reversals must not leave orphan receipts.
export function validateSales(events: Entry[]) {
  const active = activeEntries(events);
  const claimed = new Set<string>();
  for (const sale of active.filter((e) => e.saleTerms)) {
    const linked = (sale.saleTerms!.receiptIds ?? []).map((id) => {
      const receipt = active.find((e) => e.id === id);
      if (
        !receipt ||
        receipt.kind !== "sale" ||
        receipt.saleTerms ||
        receipt.saleId ||
        receipt.dealId !== sale.dealId ||
        receipt.date < sale.date ||
        claimed.has(id)
      )
        throw new Error("Invalid or already linked historical sale receipt");
      claimed.add(id);
      return receipt;
    });
    linked.push(...active.filter((e) => e.saleId === sale.id));
    const receipts = [sale, ...linked];
    if (
      receipts.reduce((n, e) => n + e.amount, 0) > sale.saleTerms!.total ||
      receipts.reduce((n, e) => n + e.fees, 0) > sale.saleTerms!.fees
    )
      throw new Error("Receipts or fees exceed the agreed sale total");
  }
  for (const receipt of active.filter((e) => e.saleId)) {
    const sale = active.find((e) => e.id === receipt.saleId && e.saleTerms);
    if (!sale || sale.dealId !== receipt.dealId || sale.date > receipt.date)
      throw new Error(
        "Installment must link to an active sale in this deal on or before its date",
      );
  }
  for (const closing of active.filter((e) => e.close)) {
    for (const sale of active.filter(
      (e) => e.dealId === closing.dealId && e.saleTerms,
    )) {
      const received = active
        .filter(
          (e) =>
            e.date <= closing.date &&
            (e.id === sale.id ||
              e.saleId === sale.id ||
              sale.saleTerms!.receiptIds?.includes(e.id)),
        )
        .reduce((n, e) => n + e.amount, 0);
      if (received < sale.saleTerms!.total)
        throw new Error(
          "Keep the deal open until all sale installments are received",
        );
    }
  }
}

// Exact largest-remainder splits for inventory, with input order breaking ties.
function split(total: number, weights: number[]) {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (!sum) return weights.map(() => 0);
  const rows = weights.map((w, i) => ({
    i,
    value: Number((BigInt(total) * BigInt(w)) / BigInt(sum)),
    remainder: (BigInt(total) * BigInt(w)) % BigInt(sum),
  }));
  let left = total - rows.reduce((n, r) => n + r.value, 0);
  for (const r of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.i - b.i
      : a.remainder > b.remainder
        ? -1
        : 1,
  ))
    if (left-- > 0) r.value++;
  return rows.map((r) => r.value);
}
function signedAllocation(total: number, deal: Deal) {
  const values = allocate(Math.abs(total), deal.members);
  for (const p of ids) values[p] *= Math.sign(total);
  return values;
}
export type SaleResult = {
  id: string;
  date: string;
  label: string;
  total: number | null;
  received: number | null;
  owed: number | null;
  fees: number;
  cost: number | null;
  profit: number | null;
  shares: ReturnType<typeof zero>;
};

export function salePerformance(
  deal: Deal,
  events: Entry[],
  inventory?: Inventory[],
  asOf = "9999-12-31",
) {
  // Keep future receipts available for historical definitions, but never count future cash.
  const active = activeEntries(
    events.filter((e) => e.kind !== "void" || e.date <= asOf),
  );
  const sales = active.filter(
    (e) => e.dealId === deal.id && ["sale", "credit_sale"].includes(e.kind),
  );
  const leaves = inventory?.filter(
    (i) =>
      i.deal_id === deal.id && !inventory.some((c) => c.parent_id === i.id),
  );
  const items = leaves?.length
    ? leaves.map((i) => ({
        id: i.id,
        name: i.name,
        cost: i.cost_cents,
        quantity: i.quantity,
      }))
    : deal.inventory?.length
      ? deal.inventory
      : [{ id: deal.id, name: deal.name, cost: deal.cost, quantity: 1 }];
  const claimed = new Set(sales.flatMap((e) => e.saleTerms?.receiptIds ?? []));
  const groups = sales
    .filter((e) => e.saleTerms)
    .map((e) => ({
      entry: e,
      receipts: sales.filter(
        (r) =>
          r.id === e.id ||
          r.saleId === e.id ||
          e.saleTerms!.receiptIds?.includes(r.id),
      ),
      total: e.saleTerms!.total as number | null,
      fees: e.saleTerms!.fees,
    }));
  const legacy = sales.filter(
    (e) => !e.saleTerms && !e.saleId && !claimed.has(e.id),
  );
  const legacyCash = legacy.filter((e) => e.kind === "sale");
  // Old fully closed cash deals have a known final total; open unlinked receipts do not.
  if (legacyCash.length && !groups.length && legacyCash.some((e) => e.close)) {
    const last = legacyCash.find((e) => e.close)!;
    groups.push({
      entry: last,
      receipts: legacyCash,
      total: legacyCash.reduce((n, e) => n + e.amount, 0),
      fees: legacyCash.reduce((n, e) => n + e.fees, 0),
    });
  } else {
    for (const e of legacyCash)
      groups.push({ entry: e, receipts: [e], total: null, fees: e.fees });
  }
  for (const e of legacy.filter((e) => e.kind === "credit_sale"))
    groups.push({ entry: e, receipts: [e], total: e.amount, fees: e.fees });

  const expenses = active.filter(
    (e) => e.dealId === deal.id && e.kind === "expense" && e.date <= asOf,
  );
  const expenseParts = expenses.map((e) => ({
    entry: e,
    costs: split(
      e.amount,
      items.map((i) => i.cost),
    ),
  }));
  const used = new Map<string, number>();
  const rows: SaleResult[] = [];
  for (const g of groups.sort((a, b) =>
    a.entry.date.localeCompare(b.entry.date),
  )) {
    if (g.entry.date > asOf) continue;
    let lines = g.receipts.flatMap((e) => e.soldItems ?? []);
    if (!lines.length && g.entry.close)
      lines = items
        .map((i) => ({
          itemId: i.id,
          quantity: i.quantity - (used.get(i.id) ?? 0),
        }))
        .filter((i) => i.quantity > 0);
    let cost = 0,
      known = lines.length > 0;
    const offset = zero();
    const names: string[] = [];
    for (const line of lines) {
      const index = items.findIndex((i) => i.id === line.itemId);
      const item = items[index];
      const before = used.get(line.itemId) ?? 0;
      const after = before + line.quantity;
      if (!item || after > item.quantity) {
        known = false;
        continue;
      }
      used.set(item.id, after);
      names.push(item.name);
      // Cumulative integer shares conserve every cent across partial quantities.
      const portion = (n: number) =>
        Math.sign(n) *
        (Number((BigInt(Math.abs(n)) * BigInt(after)) / BigInt(item.quantity)) -
          Number(
            (BigInt(Math.abs(n)) * BigInt(before)) / BigInt(item.quantity),
          ));
      cost += portion(item.cost);
      for (const { entry: expense, costs } of expenseParts) {
        const prefix = costs.slice(0, index).reduce((n, c) => n + c, 0);
        const start =
          prefix +
          Number(
            (BigInt(costs[index]) * BigInt(before)) / BigInt(item.quantity),
          );
        const end =
          prefix +
          Number(
            (BigInt(costs[index]) * BigInt(after)) / BigInt(item.quantity),
          );
        cost += end - start;
        const standardStart = allocate(start, deal.members),
          standardEnd = allocate(end, deal.members);
        const customStart = allocate(
            start,
            expense.allocations ?? deal.members,
          ),
          customEnd = allocate(end, expense.allocations ?? deal.members);
        for (const p of ids)
          offset[p] +=
            standardEnd[p] - standardStart[p] - customEnd[p] + customStart[p];
      }
    }
    // Internal transfers settle in the personal ledger, whose payments may be
    // unallocated or hidden from other owners by RLS. Do not infer nonpayment.
    const received =
      g.entry.kind === "credit_sale"
        ? null
        : g.receipts
            .filter((e) => e.date <= asOf)
            .reduce((n, e) => n + e.amount, 0);
    const profit = known && g.total !== null ? g.total - g.fees - cost : null;
    const shares = profit === null ? zero() : signedAllocation(profit, deal);
    if (profit !== null) for (const p of ids) shares[p] += offset[p];
    rows.push({
      id: g.entry.id,
      date: g.entry.date,
      label: names.join(", ") || "Unidentified items",
      total: g.total,
      received,
      owed: g.total === null || received === null ? null : g.total - received,
      fees: g.fees,
      cost: known ? cost : null,
      profit,
      shares,
    });
  }
  const shares = zero();
  for (const row of rows) for (const p of ids) shares[p] += row.shares[p];
  return {
    rows,
    shares,
    profit: rows.reduce((n, r) => n + (r.profit ?? 0), 0),
    incomplete: rows.filter((r) => r.profit === null).length,
    received: rows.reduce((n, r) => n + (r.received ?? 0), 0),
    owed: rows.reduce((n, r) => n + (r.owed ?? 0), 0),
    unknownReceived: rows.some((r) => r.received === null),
    unknownOwed: rows.some((r) => r.owed === null),
  };
}
