"use client";
import { useEffect, useMemo, useRef } from "react";
import { Data, Deal, PersonId, money, people } from "@/lib/model";
import { MetricKind, metricBreakdown } from "@/lib/metric-breakdown";

export default function MetricBreakdown({
  data,
  kind,
  person,
  onBack,
  onDeal,
}: {
  data: Data;
  kind: MetricKind;
  person?: PersonId;
  onBack: () => void;
  onDeal: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [kind, person]);
  const result = useMemo(() => metricBreakdown(data, person), [data, person]);
  const proceeds = kind === "proceeds";
  const display = (value: number | null) =>
    value === null ? "Unknown" : money(value);
  const ownership = (deal: Deal) =>
    person
      ? `${((100 * (deal.members.find((m) => m.person === person)?.weight ?? 0)) / deal.members.reduce((n, m) => n + m.weight, 0)).toLocaleString("en-US", { maximumFractionDigits: 2 })}% ownership`
      : "All owners";
  return (
    <section className="panel metric-breakdown">
      <div className="panel-body">
        <button className="text-button back" onClick={onBack}>
          ← Back to dashboard
        </button>
        <h2 ref={heading} tabIndex={-1}>
          {person ? people[person] : "Portfolio"} ·{" "}
          {proceeds ? "Net sale proceeds" : "Realized profit / loss"}
        </h2>
        <p className="statement-total">
          {money(proceeds ? result.proceeds : result.profit)}
        </p>
        <p>
          {proceeds
            ? "Your ownership share of collected sales after recorded fees. Purchase costs are not deducted. Each installment appears on its receipt date."
            : "Profit and loss recognized on the sale date, including sales awaiting payment. Received and still owed amounts below refer to each full sale, before fees."}
        </p>
        <p className="footnote">
          Full history, oldest first. Uses current corrected ownership and the
          same calculations as the dashboard.{" "}
          {proceeds
            ? "Pending payments, reversed receipts, credit transfers, and personal payments are excluded."
            : "Partner profit includes recorded custom expense splits, so it may differ from a simple ownership percentage of total profit. Internal credit transfers have unknown cash receipts here; repayments are tracked in the personal ledger."}
        </p>
        {!proceeds && result.incomplete > 0 && (
          <p className="metric-incomplete" role="status">
            {result.incomplete} sale(s) incomplete: missing sale totals or item
            cost allocations. Their unknown profit is excluded from the total,
            not treated as zero profit.
          </p>
        )}
      </div>
      <div className="metric-rows">
        {proceeds
          ? result.receipts.map((row) => (
              <article className="metric-row" key={row.receipt.id}>
                <div className="metric-row-heading">
                  <span>{row.receipt.date} · Receipt</span>
                  <strong>
                    {money(row.amount)} {person ? "your share" : "net proceeds"}
                  </strong>
                </div>
                <button
                  className="text-button"
                  onClick={() => onDeal(row.deal.id)}
                >
                  {row.deal.name} →
                </button>
                <p>
                  {ownership(row.deal)} · Collected by{" "}
                  {people[row.receipt.from]}
                </p>
                <dl className="metric-facts">
                  <div>
                    <dt>Received</dt>
                    <dd>{money(row.receipt.amount)}</dd>
                  </div>
                  <div>
                    <dt>Recorded fees</dt>
                    <dd>{money(row.receipt.fees)}</dd>
                  </div>
                  <div>
                    <dt>Net receipt</dt>
                    <dd>{money(row.net)}</dd>
                  </div>
                  <div>
                    <dt>Running total</dt>
                    <dd>{money(row.running)}</dd>
                  </div>
                </dl>
                <details>
                  <summary>Calculation and original note</summary>
                  <p>
                    Received {money(row.receipt.amount)} − fees{" "}
                    {money(row.receipt.fees)} = {money(row.net)} net.{" "}
                    {ownership(row.deal)} allocates {money(row.amount)} to this
                    metric, using per-receipt cent rounding.
                  </p>
                  <p className="metric-note">{row.receipt.notes}</p>
                </details>
              </article>
            ))
          : result.sales.map((row) => (
              <article
                className="metric-row"
                key={`${row.deal.id}:${row.sale.id}`}
              >
                <div className="metric-row-heading">
                  <span>{row.sale.date} · Sale date</span>
                  <strong>
                    {row.amount === null
                      ? "Incomplete"
                      : `${money(row.amount)} ${person ? "your profit / loss" : "profit / loss"}`}
                  </strong>
                </div>
                <button
                  className="text-button"
                  onClick={() => onDeal(row.deal.id)}
                >
                  {row.deal.name} →
                </button>
                <p>
                  {row.sale.label} · {ownership(row.deal)}
                </p>
                <dl className="metric-facts">
                  <div>
                    <dt>Sale price</dt>
                    <dd>{display(row.sale.total)}</dd>
                  </div>
                  <div>
                    <dt>Sale fees</dt>
                    <dd>{money(row.sale.fees)}</dd>
                  </div>
                  <div>
                    <dt>Allocated purchase cost</dt>
                    <dd>{display(row.sale.purchaseCost)}</dd>
                  </div>
                  <div>
                    <dt>Allocated expenses</dt>
                    <dd>{display(row.sale.expenseCost)}</dd>
                  </div>
                  <div>
                    <dt>Total sale profit / loss</dt>
                    <dd>{display(row.sale.profit)}</dd>
                  </div>
                  <div>
                    <dt>Received · full sale</dt>
                    <dd>{display(row.sale.received)}</dd>
                  </div>
                  <div>
                    <dt>Still owed · full sale</dt>
                    <dd>{display(row.sale.owed)}</dd>
                  </div>
                  <div>
                    <dt>Running profit / loss</dt>
                    <dd>{money(row.running)}</dd>
                  </div>
                </dl>
                <details>
                  <summary>Calculation and original notes</summary>
                  {row.amount === null ? (
                    <p>
                      Profit cannot yet be calculated:{" "}
                      {row.sale.total === null ? "sale total is unknown. " : ""}
                      {row.sale.cost === null
                        ? "sold items or their cost allocations are missing."
                        : ""}{" "}
                      This row does not change the running total.
                    </p>
                  ) : (
                    <p>
                      {money(row.sale.total!)} sale price −{" "}
                      {money(row.sale.fees)} fees −{" "}
                      {money(row.sale.purchaseCost!)} purchase cost −{" "}
                      {money(row.sale.expenseCost!)} expenses ={" "}
                      {money(row.sale.profit!)} total profit/loss.{" "}
                      {person && (
                        <>
                          After ownership and any custom expense allocations,{" "}
                          {people[person]}’s profit/loss is {money(row.amount)}.
                        </>
                      )}
                    </p>
                  )}
                  {row.sale.expenses.map((expense) => {
                    const entry = data.events.find((e) => e.id === expense.id);
                    return (
                      <div key={expense.id} className="metric-expense">
                        <strong>Expense · {entry?.date}</strong>
                        <p>
                          {money(expense.amount)} allocated to this sale
                          {person
                            ? `; ${people[person]}’s assigned expense: ${money(expense.shares[person])}`
                            : ""}
                          .{" "}
                          {entry?.allocations
                            ? "Custom expense split."
                            : "Ownership expense split."}
                        </p>
                        <p className="metric-note">{entry?.notes}</p>
                      </div>
                    );
                  })}
                  {row.notes.map((e) => (
                    <div key={e.id}>
                      <strong>{e.date}</strong>
                      <p className="metric-note">{e.notes}</p>
                    </div>
                  ))}
                </details>
              </article>
            ))}
        {(proceeds ? result.receipts.length : result.sales.length) === 0 && (
          <p className="empty compact">
            No {proceeds ? "collected sale receipts" : "sales"} recorded for
            this view.
          </p>
        )}
      </div>
      <div className="panel-body metric-footer">
        <strong>Total · matches dashboard</strong>
        <strong>{money(proceeds ? result.proceeds : result.profit)}</strong>
      </div>
    </section>
  );
}
