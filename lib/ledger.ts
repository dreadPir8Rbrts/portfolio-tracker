import { Deal, Entry, PersonId, Inventory, ids } from "./model";
import { validateSales } from "./sales";
export const zero = () =>
  Object.fromEntries(ids.map((id) => [id, 0])) as Record<PersonId, number>;
// Integer largest-remainder allocation. Caller order breaks ties deterministically.
export function allocate(
  total: number,
  weights: { person: PersonId; weight: number }[],
) {
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error("Invalid allocation");
  const sum = weights.reduce((s, x) => s + x.weight, 0);
  if (sum <= 0) throw new Error("No allocation weights");
  const rows = weights.map((x, i) => {
    const n = BigInt(total) * BigInt(x.weight);
    return {
      ...x,
      i,
      value: Number(n / BigInt(sum)),
      remainder: n % BigInt(sum),
    };
  });
  let remaining = total - rows.reduce((s, x) => s + x.value, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.i - b.i
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (remaining-- > 0) row.value++;
  }
  return Object.assign(
    zero(),
    Object.fromEntries(rows.map((x) => [x.person, x.value])),
  );
}
export type Edge = { from: PersonId; to: PersonId; amount: number };
export function settle(positions: Record<PersonId, number>): Edge[] {
  const debt = ids
    .filter((p) => positions[p] < 0)
    .map((p) => ({ p, n: -positions[p] }));
  const credit = ids
    .filter((p) => positions[p] > 0)
    .map((p) => ({ p, n: positions[p] }));
  const out: Edge[] = [];
  for (const d of debt)
    for (const c of credit) {
      const n = Math.min(d.n, c.n);
      if (n) {
        out.push({ from: d.p, to: c.p, amount: n });
        d.n -= n;
        c.n -= n;
      }
    }
  if (debt.some((x) => x.n) || credit.some((x) => x.n))
    throw new Error("Ledger does not reconcile");
  return out;
}
export function activeEntries(entries: Entry[]): Entry[] {
  const voided = new Set(
    entries.filter((e) => e.kind === "void").map((e) => e.target),
  );
  return entries.filter((e) => e.kind !== "void" && !voided.has(e.id));
}
export function project(deal: Deal, entries: Entry[]) {
  const capital = zero(),
    pending = zero(),
    profit = zero();
  let proceeds = 0,
    cost = deal.cost,
    closed = false;
  const members = deal.members;
  const expenseOffset = zero();
  const costShares = allocate(deal.cost, members);
  // Seller credit assigns asset cost basis to the buyer, not fictitious cash.
  // Its payable is a separate purchase_obligation visible to buyer and seller.
  for (const m of members) capital[m.person] = m.funded;
  if (deal.fundingMode === "seller_credit")
    capital[deal.creditObligor ?? members[0].person] = deal.cost;
  const funded = zero();
  for (const m of members) funded[m.person] = m.funded;
  if (deal.fundingMode === "seller_credit") {
    for (const e of activeEntries(entries)) {
      if (
        e.kind === "payment" &&
        e.acquisitionId === deal.id &&
        e.to === deal.seller &&
        members.some((m) => m.person === e.from)
      )
        funded[e.from] += e.amount;
    }
  }
  let purchasePaid = 0;
  const participants = new Set([
    ...members.map((m) => m.person),
    ...(deal.funders ?? []),
  ]);
  const total = () => ids.reduce((s, p) => s + capital[p], 0);
  const position = () => {
    const share = allocate(total(), members);
    return Object.fromEntries(
      ids.map((p) => [
        p,
        capital[p] - share[p] + pending[p] + expenseOffset[p],
      ]),
    ) as Record<PersonId, number>;
  };
  for (const e of activeEntries(entries)
    .filter((e) => e.dealId === deal.id)
    .sort((a, b) => a.date.localeCompare(b.date))) {
    if (
      e.date < deal.acquired &&
      !["purchase_funding", "expense"].includes(e.kind)
    )
      throw new Error("Deal transactions cannot precede acquisition");
    if (
      !participants.has(e.from) ||
      (e.to && e.kind !== "credit_sale" && !participants.has(e.to))
    )
      throw new Error("People must participate in this deal");
    if (e.kind === "purchase_funding") {
      if (deal.fundingMode !== "payments" || closed || proceeds > 0)
        throw new Error(
          "Purchase funding requires an unsold payment-tracked deal",
        );
      purchasePaid += e.amount;
      if (purchasePaid > deal.cost)
        throw new Error(
          "Purchase funding exceeds purchase price; record fees as expenses",
        );
      capital[e.from] += e.amount;
      funded[e.from] += e.amount;
    } else if (e.kind === "sale" || e.kind === "credit_sale") {
      if (deal.fundingMode === "payments" && purchasePaid !== deal.cost)
        throw new Error("Complete purchase funding before recording sales");
      if (closed) throw new Error("This deal is already fully sold");
      const net = e.amount - e.fees;
      proceeds += net;
      const recovery = Math.min(net, total());
      const returned = recovery
        ? allocate(
            recovery,
            ids.map((person) => ({ person, weight: capital[person] })),
          )
        : zero();
      const gains = allocate(net - recovery, members);
      for (const p of ids) {
        capital[p] -= returned[p];
        pending[p] += returned[p] + gains[p];
        profit[p] += gains[p];
      }
      pending[e.from] -= net;
      if (e.close) {
        closed = true;
        const losses = allocate(total(), members);
        for (const p of ids) profit[p] -= losses[p];
      }
    } else if (e.kind === "expense") {
      if (closed) throw new Error("Record expenses before the final sale");
      if (
        e.allocations?.some((a) => !members.some((m) => m.person === a.person))
      )
        throw new Error("Expense allocations must use deal participants");
      const standard = allocate(e.amount, members),
        custom = allocate(e.amount, e.allocations ?? members);
      for (const p of ids) {
        expenseOffset[p] += standard[p] - custom[p];
        costShares[p] += custom[p];
      }
      capital[e.from] += e.amount;
      cost += e.amount;
    } else if (e.kind === "funding_repayment") {
      if (closed) throw new Error("Use a distribution to settle a closed deal");
      const to = e.to!;
      const shares = allocate(total(), members);
      const fundingPositions = Object.fromEntries(
        ids.map((p) => [p, capital[p] - shares[p]]),
      ) as Record<PersonId, number>;
      const due =
        settle(fundingPositions).find((x) => x.from === e.from && x.to === to)
          ?.amount ?? 0;
      if (e.amount > capital[to] || e.amount > due)
        throw new Error(
          "Repayment exceeds outstanding funding debt to this person",
        );
      capital[to] -= e.amount;
      capital[e.from] += e.amount;
    } else if (e.kind === "distribution") {
      const due =
        settle(position()).find((x) => x.from === e.from && x.to === e.to)
          ?.amount ?? 0;
      if (e.amount > due)
        throw new Error("Distribution exceeds the current amount owed");
      if (!closed && pending[e.from] >= 0)
        throw new Error("Use funding repayment for purchase debt");
      if (
        !closed &&
        e.amount > Math.min(-pending[e.from], Math.max(0, pending[e.to!]))
      )
        throw new Error(
          "Distribution exceeds collected proceeds payable to this person",
        );
      pending[e.from] += e.amount;
      pending[e.to!] -= e.amount;
    }
  }
  if (closed || total() === 0)
    for (const p of ids) profit[p] += expenseOffset[p];
  const positions = position();
  return {
    capital,
    funded,
    costShares,
    pending,
    positions,
    edges: settle(positions),
    proceeds,
    cost,
    closed,
    profit,
    unrecovered: total(),
  };
}
export function balances(deals: Deal[], entries: Entry[]): Edge[] {
  const pairs = new Map<string, number>();
  const add = (a: PersonId, b: PersonId, n: number) => {
    const key = [a, b].sort().join("|");
    pairs.set(key, (pairs.get(key) ?? 0) + (a < b ? n : -n));
  };
  for (const d of deals)
    for (const e of project(d, entries).edges) add(e.from, e.to, e.amount);
  for (const e of activeEntries(entries).filter((e) => !e.dealId)) {
    if (
      e.kind === "purchase_obligation" ||
      e.kind === "opening" ||
      e.kind === "adjustment"
    )
      add(e.from, e.to!, e.amount);
    else if (e.kind === "payment" || e.kind === "on_behalf")
      add(e.from, e.to!, -e.amount);
  }
  return [...pairs]
    .filter(([, n]) => n !== 0)
    .map(([k, n]) => {
      const [a, b] = k.split("|") as PersonId[];
      return { from: n > 0 ? a : b, to: n > 0 ? b : a, amount: Math.abs(n) };
    });
}
export function validateEntry(entry: Entry, deals: Deal[], events: Entry[]) {
  validateSales([...events, entry]);
  if (events.some((e) => e.id === entry.id))
    throw new Error("Entry already recorded");
  if (entry.kind === "void") {
    const target = events.find((e) => e.id === entry.target);
    if (
      !target ||
      target.kind === "void" ||
      ["purchase_obligation", "ownership_correction", "credit_sale"].includes(
        target.kind,
      ) ||
      target.dealId !== entry.dealId ||
      events.some((e) => e.target === target.id)
    )
      throw new Error("Invalid reversal target");
    const latest = activeEntries(events)
      .filter((e) => e.dealId === entry.dealId)
      .at(-1);
    if (latest?.id !== target.id)
      throw new Error("Reverse later entries in this ledger first");
  }
  if (entry.kind === "ownership_correction") {
    const d = deals.find((d) => d.id === entry.dealId);
    const r = entry.revision;
    if (
      !d ||
      !r ||
      r.before.id !== d.id ||
      r.after.id !== d.id ||
      entry.date !== d.acquired ||
      JSON.stringify(r.after.members) !== JSON.stringify(d.members) ||
      r.after.cost !== d.cost ||
      r.before.cost !== d.cost ||
      r.after.creditObligor !== d.creditObligor ||
      r.before.seller !== d.seller ||
      r.after.seller !== d.seller
    )
      throw new Error("Ownership correction does not match the revised deal");
  }
  if (entry.kind === "credit_sale") {
    const buyer = deals.find((d) => d.id === entry.acquisitionId);
    if (
      !buyer ||
      buyer.fundingMode !== "seller_credit" ||
      buyer.members.length !== 1 ||
      buyer.members[0].person !== entry.to ||
      buyer.seller !== entry.from ||
      buyer.cost !== entry.amount ||
      buyer.acquired !== entry.date ||
      entry.fees !== 0
    )
      throw new Error("Credit sale must match its buyer acquisition");
    if (
      events.some(
        (e) =>
          e.kind === "credit_sale" && e.acquisitionId === entry.acquisitionId,
      )
    )
      throw new Error("Transfer already recorded");
    if (
      buyer.inventory?.length !== entry.soldItems?.length ||
      buyer.inventory?.some(
        (i) =>
          !entry.soldItems?.some(
            (s) =>
              s.itemId === i.previousInventoryId && s.quantity === i.quantity,
          ),
      )
    )
      throw new Error("Transfer inventory does not match");
  }
  if (entry.kind === "purchase_obligation") {
    const d = deals.find((d) => d.id === entry.acquisitionId);
    if (
      !d ||
      d.fundingMode !== "seller_credit" ||
      entry.from !== (d.creditObligor ?? d.members[0].person) ||
      entry.to !== d.seller ||
      entry.amount !== d.cost ||
      entry.date !== d.acquired
    )
      throw new Error(
        "Purchase obligation must match its seller-credit acquisition",
      );
    if (
      events.some(
        (e) => e.kind === "purchase_obligation" && e.acquisitionId === d.id,
      )
    )
      throw new Error("Purchase obligation already recorded");
  }
  if (entry.dealId) {
    const d = deals.find((d) => d.id === entry.dealId);
    if (!d) throw new Error("Deal not found");
    project(d, [...events, entry]);
  }
}

export function prepareEntry(
  entry: Entry,
  deals: Deal[],
  events: Entry[],
  inventory?: Inventory[],
) {
  validateEntry(entry, deals, events);
  const delta = zero();
  if (entry.kind === "ownership_correction") {
    const before = project(entry.revision!.before, events).positions;
    const after = project(entry.revision!.after, events).positions;
    for (const p of ids) delta[p] = after[p] - before[p];
  } else if (entry.dealId) {
    const d = deals.find((d) => d.id === entry.dealId)!;
    const before = project(d, events).positions,
      after = project(d, [...events, entry]).positions;
    for (const p of ids) delta[p] = after[p] - before[p];
  } else {
    const source =
      entry.kind === "void"
        ? events.find((e) => e.id === entry.target)!
        : entry;
    const sign =
      (source.kind === "purchase_obligation" ||
      source.kind === "opening" ||
      source.kind === "adjustment"
        ? -1
        : 1) * (entry.kind === "void" ? -1 : 1);
    delta[source.from] += sign * source.amount;
    delta[source.to!] -= sign * source.amount;
  }
  let soldItems = entry.soldItems;
  if (
    ["sale", "credit_sale"].includes(entry.kind) &&
    entry.close &&
    !entry.saleId &&
    !soldItems?.length
  ) {
    const deal = deals.find((d) => d.id === entry.dealId)!;
    const items = inventory?.filter(
      (i) =>
        i.deal_id === deal.id && !inventory.some((c) => c.parent_id === i.id),
    ) ??
      deal.inventory?.map((i) => ({ id: i.id, quantity: i.quantity })) ?? [
        { id: deal.id, quantity: 1 },
      ];
    soldItems = items
      .map((i) => ({
        itemId: i.id,
        quantity:
          i.quantity -
          activeEntries(events)
            .flatMap((e) => e.soldItems ?? [])
            .filter((s) => s.itemId === i.id)
            .reduce((n, s) => n + s.quantity, 0),
      }))
      .filter((i) => i.quantity > 0);
  }
  if (entry.kind === "sale" && entry.saleId && entry.close) {
    const deal = deals.find((d) => d.id === entry.dealId)!;
    const items = inventory?.filter(
      (i) =>
        i.deal_id === deal.id && !inventory.some((c) => c.parent_id === i.id),
    ) ??
      deal.inventory ?? [{ id: deal.id, quantity: 1 }];
    if (
      items.some(
        (i) =>
          i.quantity >
          activeEntries(events)
            .flatMap((e) => e.soldItems ?? [])
            .filter((s) => s.itemId === i.id)
            .reduce((n, s) => n + s.quantity, 0),
      )
    )
      throw new Error(
        "An installment cannot close a deal with unsold inventory",
      );
  }
  return {
    ...entry,
    soldItems,
    _postings: ids
      .filter((p) => delta[p] !== 0)
      .map((person) => ({ person, amount: delta[person] })),
  };
}
export function balanceAt(
  deals: Deal[],
  events: Entry[],
  asOf: string,
  from: PersonId,
  to: PersonId,
) {
  const edges = balances(
    deals.filter(
      (d) =>
        d.acquired <= asOf ||
        (d.fundingMode === "payments" &&
          events.some((e) => e.dealId === d.id && e.date <= asOf)),
    ),
    events.filter((e) => e.date <= asOf),
  );
  const edge = edges.find(
    (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
  );
  return edge ? edge.amount * (edge.from === from ? 1 : -1) : 0;
}
