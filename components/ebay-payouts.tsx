"use client";
import { useMemo, useState } from "react";
import { Data, PersonId, money, people } from "@/lib/model";
import {
  ebayPayouts,
  sourceCategories,
  summarizePayouts,
} from "@/lib/ebay-payouts";

export default function EbayPayouts({
  data,
  person,
  onDeal,
}: {
  data: Data;
  person: PersonId;
  onDeal: (id: string) => void;
}) {
  const [month, setMonth] = useState("");
  const [partner, setPartner] = useState("");
  const result = useMemo(() => {
    try {
      return { data: ebayPayouts(data, person), error: "" };
    } catch {
      return {
        data: null,
        error:
          "Payout debt effects could not be reconciled. Please ask the admin to review the ledger.",
      };
    }
  }, [data, person]);
  const all = result.data?.rows ?? [];
  const months = [
    ...new Set([
      ...all.map((r) => r.entry.date.slice(0, 7)),
      ...(result.data?.refunds ?? []).map((e) => e.date.slice(0, 7)),
    ]),
  ]
    .sort()
    .reverse();
  const partners = [...new Set(all.flatMap((r) => r.partners))];
  const rows = all.filter(
    (r) =>
      (!month || r.entry.date.startsWith(month)) &&
      (!partner || r.partners.includes(partner as PersonId)),
  );
  const totals = summarizePayouts(rows);
  const refunds = (result.data?.refunds ?? [])
    .filter(
      (e) =>
        (!month || e.date.startsWith(month)) &&
        (!partner || e.from === partner || e.to === partner),
    )
    .reduce((n, e) => n + e.amount, 0);
  const signed = (n: number) =>
    `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;
  return (
    <section className="panel ebay-payouts">
      <div className="panel-heading">
        <div>
          <h2>eBay payouts</h2>
          <p>
            Recorded payouts involving {people[person]}, with shared proceeds
            and forwarded funds shown separately.
          </p>
        </div>
      </div>
      <div className="panel-body">
        <div className="payout-filters">
          <label>
            Received month
            <select
              aria-label="eBay payout month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">All months</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {new Date(m + "-01T12:00:00").toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </option>
              ))}
            </select>
          </label>
          <label>
            Partner
            <select
              aria-label="eBay payout partner"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
            >
              <option value="">All partners</option>
              {partners.map((p) => (
                <option key={p} value={p}>
                  {people[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {result.error ? (
          <p role="alert">{result.error}</p>
        ) : (
          <>
            <div className="payout-totals">
              {[
                ["Total eBay payouts", totals.total],
                ["Shared payouts · full amount", totals.shared],
                [
                  `${people[person]}’s share of shared payouts`,
                  totals.sharedShare,
                ],
                ["Personal payouts", totals.personal],
                ["Pass-through payouts", totals.passThrough],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{money(Number(value))}</strong>
                </div>
              ))}
            </div>
            <p className="footnote">
              {totals.count} payout{totals.count === 1 ? "" : "s"} ·{" "}
              {rows.length} incoming allocation{rows.length === 1 ? "" : "s"}.
              Totals use received amounts after recorded fees, not gross eBay
              sales. Purchases, refunds ({money(refunds)}), reversed entries,
              and outgoing transfers are excluded.
            </p>
            <p className="footnote">
              Shares follow recorded ownership. Debt effects also reflect
              funding recovery and offsets; a share and its debt effect can
              differ. Negative changes reduce {people[person]}’s debt to the
              named partner. Linked forwarding includes all recorded dates, even
              outside the selected receipt month.
            </p>
            {!rows.length && (
              <p className="empty compact">
                No classified eBay payouts for this selection.
              </p>
            )}
            <div className="payout-list">
              {rows.map((row) => (
                <details className="payout-row" key={row.entry.id}>
                  <summary>
                    <span>
                      <strong>
                        {sourceCategories[row.entry.sourceCategory!]}
                      </strong>
                      <small>
                        {row.entry.date} · Received by {people[row.receivedBy]}
                      </small>
                    </span>
                    <strong>{money(row.amount)}</strong>
                  </summary>
                  <div className="payout-detail">
                    <p>{row.entry.notes}</p>
                    {row.entry.payoutGroup && (
                      <p>
                        Allocation of payout {row.entry.payoutGroup} ·{" "}
                        {money(
                          all
                            .filter((r) => r.group === row.group)
                            .reduce((n, r) => n + r.amount, 0),
                        )}{" "}
                        total recorded across its allocations.
                      </p>
                    )}
                    {row.entry.fees > 0 && (
                      <p>
                        {money(row.entry.amount)} received less{" "}
                        {money(row.entry.fees)} recorded fees.
                      </p>
                    )}
                    {row.deal && (
                      <button
                        className="text-button"
                        onClick={() => onDeal(row.deal!.id)}
                      >
                        {row.deal.name} →
                      </button>
                    )}
                    {row.shares && row.deal ? (
                      <ul>
                        {row.deal.members.map((m) => (
                          <li key={m.person}>
                            {people[m.person]}: {money(row.shares![m.person])} (
                            {(
                              (100 * m.weight) /
                              row.deal!.members.reduce(
                                (n, x) => n + x.weight,
                                0,
                              )
                            ).toLocaleString("en-US", {
                              maximumFractionDigits: 2,
                            })}
                            %)
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        {row.entry.sourceCategory === "pass_through"
                          ? "Held for forwarding; no shared proceeds."
                          : `100% ${people[row.entry.from]}’s money; no split.`}
                      </p>
                    )}
                    {row.effects.map((effect) => (
                      <p key={effect.partner}>
                        Debt change to {people[effect.partner]}:{" "}
                        <strong>{signed(effect.receipt)}</strong>
                        {row.linked.length > 0 && (
                          <>
                            {" "}
                            on receipt; {signed(effect.forwarded)} from
                            forwarding;{" "}
                            <strong>
                              {signed(effect.receipt + effect.forwarded)} net
                            </strong>
                            .
                          </>
                        )}
                      </p>
                    ))}
                    {row.linked.map((e) => (
                      <div className="payout-forward" key={e.id}>
                        <strong>
                          Forwarded {money(e.amount)} · {e.date}
                        </strong>
                        <p>{e.notes}</p>
                      </div>
                    ))}
                    {row.entry.sourceCategory === "pass_through" && (
                      <p>
                        Still to forward:{" "}
                        {money(
                          row.amount -
                            row.linked.reduce((n, e) => n + e.amount, 0),
                        )}
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
