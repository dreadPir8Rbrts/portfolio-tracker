"use client";
import { useEffect, useMemo, useRef } from "react";
import { balanceStatement } from "@/lib/balance-statement";
import { Data, PersonId, money, people } from "@/lib/model";

export default function BalanceStatement({
  data,
  person,
  partner,
  onBack,
  onDeal,
}: {
  data: Data;
  person: PersonId;
  partner: PersonId;
  onBack: () => void;
  onDeal: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [person, partner]);
  const result = useMemo(() => {
    try {
      return {
        statement: balanceStatement(data.deals, data.events, person, partner),
        error: "",
      };
    } catch {
      return {
        statement: null,
        error:
          "This history could not be reconciled. Please ask the admin to review the transaction dates and ordering.",
      };
    }
  }, [data.deals, data.events, person, partner]);
  const direction = (amount: number) =>
    amount === 0
      ? "Settled — $0.00"
      : `${people[amount > 0 ? person : partner]} owes ${people[amount > 0 ? partner : person]} ${money(Math.abs(amount))}`;
  return (
    <section className="panel balance-statement">
      <div className="panel-body">
        <button className="text-button back" onClick={onBack}>
          ← Back to balances
        </button>
        <h2 ref={heading} tabIndex={-1}>
          {people[person]} &amp; {people[partner]}
        </h2>
        {result.statement && (
          <p className="statement-total">
            {direction(result.statement.balance)}
          </p>
        )}
        <p>
          Full history, oldest first. Positive changes increase {people[person]}
          ’s debt to {people[partner]}; negative changes reduce it. If the
          balance crosses zero, the direction of who owes whom changes.
        </p>
        <p className="footnote">
          Uses corrected deal ownership and effective transaction dates, with
          recorded order within each day. Amounts show the effect on this
          partnership after offsets, not necessarily the full payment.
          Unreceived cash sale proceeds do not reduce debt.
        </p>
        {result.error && <p role="alert">{result.error}</p>}
      </div>
      {result.statement && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">
              Running balance between {people[person]} and {people[partner]}
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Transaction</th>
                <th scope="col">Debt change</th>
                <th scope="col">Running balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Start</td>
                <td>Before recorded activity</td>
                <td className="statement-money" data-label="Debt change">
                  —
                </td>
                <td className="statement-running" data-label="Running balance">
                  {direction(0)}
                </td>
              </tr>
              {result.statement.rows.map((row) => (
                <tr key={row.id}>
                  <td className="statement-date">
                    {new Date(row.date + "T12:00:00").toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" },
                    )}
                  </td>
                  <td>
                    <strong>{row.title}</strong>
                    <p>{row.explanation}</p>
                    {row.dealId && (
                      <button
                        className="text-button statement-deal"
                        onClick={() => onDeal(row.dealId!)}
                      >
                        {data.deals.find((d) => d.id === row.dealId)?.name} →
                      </button>
                    )}
                    <details>
                      <summary>Original note</summary>
                      <p className="statement-note">
                        {row.notes || "No note recorded."}
                      </p>
                    </details>
                  </td>
                  <td className="statement-money" data-label="Debt change">
                    {row.change > 0 ? "+" : "−"}
                    {money(Math.abs(row.change))}
                  </td>
                  <td
                    className="statement-running"
                    data-label="Running balance"
                  >
                    {direction(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3} scope="row">
                  Current balance · matches My balances
                </th>
                <td>{direction(result.statement.balance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
