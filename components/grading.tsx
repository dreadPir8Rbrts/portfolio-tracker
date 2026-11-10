"use client";
import { useEffect, useRef, useState } from "react";
import { Data, money, people, ids, parseMoney, eventSchema } from "@/lib/model";
import { Grading, GradingRequest, gradingStatuses } from "@/lib/grading";
import { activeEntries, allocate } from "@/lib/ledger";

export default function GradingPanel({
  data,
  dealId,
  onDeal,
  onSave,
}: {
  data: Data;
  dealId?: string;
  onDeal: (id: string) => void;
  onSave: (request: GradingRequest) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Grading | "new" | null>(null);
  const [status, setStatus] = useState("active"),
    [company, setCompany] = useState(""),
    [partner, setPartner] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);
  const active = activeEntries(data.events);
  const submissions = (data.grading ?? []).filter(
    (g) => !dealId || g.deal_id === dealId,
  );
  const rows = submissions.filter(
    (g) =>
      (status === "all" ||
        (status === "active"
          ? !["returned", "cancelled"].includes(g.status)
          : g.status === status)) &&
      (!company || g.grading_company === company) &&
      (!partner ||
        data.deals
          .find((d) => d.id === g.deal_id)
          ?.members.some((m) => m.person === partner)),
  );
  return (
    <section className="panel grading-panel">
      <div className="panel-heading">
        <div>
          <h2>{dealId ? "Grading submissions" : "Grading overview"}</h2>
          <p>
            One record per card. Grades and submission updates do not move
            money.
          </p>
        </div>
        {data.admin && (
          <button className="primary" onClick={() => setEditing("new")}>
            Add submission
          </button>
        )}
      </div>
      <div className="panel-body">
        <div className="payout-filters">
          <label>
            Status
            <select
              aria-label="Grading status filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Active / awaiting return</option>
              <option value="all">All statuses</option>
              {gradingStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Company
            <select
              aria-label="Grading company filter"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            >
              <option value="">All companies</option>
              {[...new Set(submissions.map((g) => g.grading_company))]
                .sort()
                .map((c) => (
                  <option key={c}>{c}</option>
                ))}
            </select>
          </label>
          {!dealId && (
            <label>
              Partner
              <select
                aria-label="Grading partner filter"
                value={partner}
                onChange={(e) => setPartner(e.target.value)}
              >
                <option value="">All partners</option>
                {ids.map((id) => (
                  <option value={id} key={id}>
                    {people[id]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {!rows.length && (
          <p className="empty compact">
            No grading submissions for this selection.
          </p>
        )}
        {rows
          .sort((a, b) => b.date_submitted.localeCompare(a.date_submitted))
          .map((g) => {
            const deal = data.deals.find((d) => d.id === g.deal_id);
            const expense = active.find((e) => e.id === g.expense_entry_id);
            const shares =
              expense && deal
                ? allocate(expense.amount, expense.allocations ?? deal.members)
                : null;
            return (
              <article className="grading-row" key={g.id}>
                <div className="metric-row-heading">
                  <h3>{g.card_name}</h3>
                  <span className="tag">{g.status}</span>
                  {data.admin && (
                    <button className="secondary" onClick={() => setEditing(g)}>
                      Edit submission
                    </button>
                  )}
                </div>
                {!dealId && (
                  <button
                    className="text-button"
                    onClick={() => onDeal(g.deal_id)}
                  >
                    {deal?.name} →
                  </button>
                )}
                <dl className="metric-facts">
                  <div>
                    <dt>Grader / tier</dt>
                    <dd>
                      {g.grading_company} ·{" "}
                      {g.submission_tier || "Tier not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt>Submitted</dt>
                    <dd>
                      {g.date_submitted} · {people[g.submitted_by]}
                    </dd>
                  </div>
                  <div>
                    <dt>Completed</dt>
                    <dd>{g.date_completed ?? "Pending"}</dd>
                  </div>
                  <div>
                    <dt>Final grade</dt>
                    <dd>{g.final_grade ?? "Pending"}</dd>
                  </div>
                  <div>
                    <dt>Final grading costs</dt>
                    <dd>
                      {g.final_grading_costs === null
                        ? "Unknown"
                        : money(g.final_grading_costs)}
                    </dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd>
                      {expense
                        ? `${people[expense.from]} · ${expense.date}`
                        : g.expense_entry_id
                          ? "Expense reversed — payment needs reconciliation"
                          : g.final_grading_costs === 0
                            ? "No charge"
                            : "Not recorded as paid"}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary>Submission and expense details</summary>
                  <p>
                    Submission reference:{" "}
                    {g.submission_reference || "Not recorded"}
                    <br />
                    Certification: {g.certification_number || "Not recorded"}
                  </p>
                  <p className="metric-note">
                    {g.notes || "No additional notes."}
                  </p>
                  {expense && (
                    <>
                      <p>{expense.notes}</p>
                      <p>
                        {expense.allocations
                          ? "Custom split"
                          : "Deal ownership split"}
                        :{" "}
                        {ids
                          .filter((p) => shares![p])
                          .map((p) => `${people[p]} ${money(shares![p])}`)
                          .join(" · ")}
                      </p>
                    </>
                  )}
                </details>
              </article>
            );
          })}
      </div>
      <dialog ref={dialog} onCancel={() => setEditing(null)}>
        <div className="modal-heading">
          <h2>
            {editing === "new"
              ? "Add grading submission"
              : "Edit grading submission"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close grading dialog"
            onClick={() => setEditing(null)}
          >
            ×
          </button>
        </div>
        {editing && (
          <GradingForm
            key={typeof editing === "string" ? "new" : editing.id}
            data={data}
            initial={typeof editing === "string" ? undefined : editing}
            dealId={dealId}
            save={async (request) => {
              await onSave(request);
              setEditing(null);
            }}
          />
        )}
      </dialog>
    </section>
  );
}

function GradingForm({
  data,
  initial,
  dealId,
  save,
}: {
  data: Data;
  initial?: Grading;
  dealId?: string;
  save: (r: GradingRequest) => Promise<void>;
}) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [expenseId] = useState(() => crypto.randomUUID());
  const [chosen, setChosen] = useState(
    initial?.deal_id ?? dealId ?? data.deals[0]?.id ?? "",
  );
  const active = activeEntries(data.events);
  const locked =
    initial?.expense_entry_id &&
    active.some((e) => e.id === initial.expense_entry_id);
  const [payment, setPayment] = useState(locked ? "locked" : "unpaid");
  const [custom, setCustom] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const deal = data.deals.find((d) => d.id === chosen);
  const expenses = active.filter(
    (e) =>
      e.kind === "expense" &&
      e.dealId === chosen &&
      !(data.grading ?? []).some(
        (g) => g.expense_entry_id === e.id && g.id !== id,
      ),
  );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const f = new FormData(e.currentTarget);
          const text = (key: string) => String(f.get(key) ?? "").trim();
          let cost = text("final_grading_costs")
            ? parseMoney(f.get("final_grading_costs"))
            : null;
          let payer: Grading["grading_costs_paid_by"] = null,
            paidOn: string | null = null,
            linked: string | null = null;
          let expense;
          if (payment === "locked" && initial) {
            cost = initial.final_grading_costs;
            payer = initial.grading_costs_paid_by;
            paidOn = initial.grading_costs_paid_on;
            linked = initial.expense_entry_id;
          }
          if (payment === "existing") {
            const existing = expenses.find(
              (x) => x.id === text("existing_expense"),
            );
            if (!existing) throw new Error("Choose an existing expense");
            cost = existing.amount;
            payer = existing.from;
            paidOn = existing.date;
            linked = existing.id;
          }
          if (payment === "new") {
            payer = text(
              "grading_costs_paid_by",
            ) as Grading["grading_costs_paid_by"];
            paidOn = text("grading_costs_paid_on");
            linked = expenseId;
            expense = eventSchema.parse({
              id: expenseId,
              dealId: chosen,
              kind: "expense",
              date: paidOn,
              amount: cost,
              from: payer,
              to: null,
              notes: `Grading costs: ${text("card_name")} (${text("grading_company")}${text("submission_tier") ? ` / ${text("submission_tier")}` : ""})`,
              ...(custom
                ? {
                    allocations: deal!.members
                      .map((m) => ({
                        person: m.person,
                        weight: Number(f.get(`weight-${m.person}`)),
                      }))
                      .filter((m) => m.weight > 0),
                  }
                : {}),
            });
          }
          await save({
            expected_version: initial?.version ?? 0,
            expense,
            submission: {
              id,
              deal_id: chosen,
              card_name: text("card_name"),
              inventory_item_id: text("inventory_item_id") || null,
              submitted_by: text("submitted_by") as Grading["submitted_by"],
              grading_company: text("grading_company"),
              submission_tier: text("submission_tier"),
              date_submitted: text("date_submitted"),
              date_completed: text("date_completed") || null,
              final_grade: text("final_grade") || null,
              final_grading_costs: cost,
              grading_costs_paid_by: payer,
              grading_costs_paid_on: paidOn,
              expense_entry_id: linked,
              status: text("status") as Grading["status"],
              submission_reference: text("submission_reference"),
              certification_number: text("certification_number"),
              notes: text("notes"),
            },
          });
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Unable to save submission",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Deal
        <select
          aria-label="Grading deal"
          value={chosen}
          disabled={!!initial || !!dealId}
          onChange={(e) => {
            setChosen(e.target.value);
            setPayment("unpaid");
            setCustom(false);
          }}
        >
          {data.deals.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Card name
        <input
          name="card_name"
          required
          maxLength={300}
          defaultValue={initial?.card_name}
        />
      </label>
      <label>
        Inventory card (optional)
        <select
          name="inventory_item_id"
          key={chosen}
          defaultValue={initial?.inventory_item_id ?? ""}
        >
          <option value="">Not individually tracked / no link</option>
          {(data.inventory ?? [])
            .filter((i) => i.deal_id === chosen && i.kind === "card")
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · {i.grade}
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Submitted by
          <select
            name="submitted_by"
            defaultValue={initial?.submitted_by ?? data.person}
          >
            {ids.map((p) => (
              <option key={p} value={p}>
                {people[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Grading company
          <input
            name="grading_company"
            list="grading-companies"
            required
            maxLength={100}
            defaultValue={initial?.grading_company ?? "PSA"}
          />
          <datalist id="grading-companies">
            <option>PSA</option>
            <option>BGS</option>
            <option>CGC</option>
          </datalist>
        </label>
        <label>
          Submission tier
          <input
            name="submission_tier"
            maxLength={100}
            defaultValue={initial?.submission_tier}
          />
        </label>
        <label>
          Date submitted
          <input
            type="date"
            name="date_submitted"
            required
            defaultValue={initial?.date_submitted}
          />
        </label>
        <label>
          Status
          <select
            aria-label="Submission status"
            name="status"
            defaultValue={initial?.status ?? "submitted"}
          >
            {gradingStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date completed
          <input
            type="date"
            name="date_completed"
            defaultValue={initial?.date_completed ?? ""}
          />
        </label>
        <label>
          Final grade
          <input
            name="final_grade"
            maxLength={100}
            placeholder="10, 9.5, Authentic…"
            defaultValue={initial?.final_grade ?? ""}
          />
        </label>
        <label>
          Submission reference
          <input
            name="submission_reference"
            maxLength={200}
            defaultValue={initial?.submission_reference}
          />
        </label>
        <label>
          Certification number
          <input
            name="certification_number"
            maxLength={200}
            defaultValue={initial?.certification_number}
          />
        </label>
      </div>
      <fieldset className="source-fields">
        <legend>Grading costs · USD</legend>
        <label>
          Payment handling
          <select
            aria-label="Grading payment handling"
            value={payment}
            disabled={!!locked}
            onChange={(e) => setPayment(e.target.value)}
          >
            {locked ? (
              <option value="locked">Recorded expense linked</option>
            ) : (
              <>
                <option value="unpaid">Not paid / not recorded yet</option>
                <option value="new">Record new paid expense</option>
                <option value="existing">Link an existing deal expense</option>
              </>
            )}
          </select>
        </label>
        <label>
          Final grading costs (leave blank if unknown)
          <input
            name="final_grading_costs"
            type="number"
            min="0"
            step="0.01"
            required={payment === "new"}
            disabled={!!locked || payment === "existing"}
            defaultValue={
              initial?.final_grading_costs == null
                ? ""
                : (initial.final_grading_costs / 100).toFixed(2)
            }
          />
        </label>
        {locked && (
          <p>
            {money(initial!.final_grading_costs!)} paid by{" "}
            {people[initial!.grading_costs_paid_by!]} on{" "}
            {initial!.grading_costs_paid_on}. Reverse the ledger expense before
            correcting payment details.
          </p>
        )}
        {!locked && initial?.expense_entry_id && (
          <p>
            The previous expense was reversed. Link a replacement, record a new
            payment, or save as not paid.
          </p>
        )}
        {payment === "existing" && (
          <label>
            Existing expense
            <select name="existing_expense" required>
              <option value="">Choose expense (no new charge)</option>
              {expenses.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date} · {money(e.amount)} · {people[e.from]} · {e.notes}
                </option>
              ))}
            </select>
          </label>
        )}
        {payment === "new" && (
          <>
            <label>
              Costs paid by
              <select name="grading_costs_paid_by" required>
                {[
                  ...new Set([
                    ...(deal?.members.map((m) => m.person) ?? []),
                    ...(deal?.funders ?? []),
                  ]),
                ].map((p) => (
                  <option key={p} value={p}>
                    {people[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Costs paid on
              <input name="grading_costs_paid_on" type="date" required />
            </label>
            <p>
              Defaults to this deal’s ownership split. Recording this expense
              updates partner balances.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={custom}
                onChange={(e) => setCustom(e.target.checked)}
              />
              Use a custom expense split
            </label>
            {custom &&
              deal?.members.map((m) => (
                <label key={m.person}>
                  {people[m.person]} · allocation weight
                  <input
                    type="number"
                    name={`weight-${m.person}`}
                    min="0"
                    max="1000000"
                    step="1"
                    defaultValue={m.weight}
                  />
                </label>
              ))}
          </>
        )}
      </fieldset>
      <label>
        Notes
        <textarea name="notes" maxLength={5000} defaultValue={initial?.notes} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy || !deal}>
        {busy ? "Saving…" : "Save submission"}
      </button>
    </form>
  );
}
