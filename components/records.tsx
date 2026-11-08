"use client";
import { useState } from "react";
import {
  Data,
  Inventory,
  PersonId,
  people,
  ids,
  money,
  parseMoney,
  checkpointSchema,
  inventorySchema,
} from "@/lib/model";
import { balanceAt, activeEntries } from "@/lib/ledger";
import { previewImport, ImportPreview } from "@/lib/importer";
export default function Records({
  data,
  demo,
  refresh,
  update,
}: {
  data: Data;
  demo: boolean;
  refresh: () => Promise<void>;
  update: (data: Data) => void;
}) {
  const [section, setSection] = useState("inventory"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [parent, setParent] = useState(""),
    [csv, setCsv] = useState(""),
    [filename, setFilename] = useState(""),
    [collector, setCollector] = useState<PersonId>("dread"),
    [preview, setPreview] = useState<ImportPreview | null>(null);
  const inventory: Inventory[] =
    data.inventory ??
    data.deals.flatMap<Inventory>(
      (d) =>
        d.inventory?.map((i) => ({
          ...i,
          deal_id: d.id,
          parent_id: null,
          cost_cents: i.cost,
        })) ?? [
          {
            id: d.id,
            deal_id: d.id,
            parent_id: null,
            kind: "lot" as const,
            name: d.name,
            variant: d.variant,
            grade: d.grade,
            certification: "",
            quantity: 1,
            cost_cents: d.cost,
            notes: d.items,
          },
        ],
    );
  const leaves = inventory.filter(
    (i) => !inventory.some((c) => c.parent_id === i.id),
  );
  async function post(path: string, value: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    return result;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="heading-actions" style={{ marginBottom: 24 }}>
        {["inventory", "reconciliation", ...(data.admin ? ["import"] : [])].map(
          (s) => (
            <button
              className={section === s ? "primary" : "secondary"}
              key={s}
              onClick={() => {
                setSection(s);
                setError("");
                setMessage("");
              }}
            >
              {s === "inventory"
                ? "Inventory records"
                : s === "import"
                  ? "Import history"
                  : "Reconcile balances"}
            </button>
          ),
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {section === "inventory" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Cards & lots</h2>
              <p>
                Child records replace a subdivided lot. Purchase cost and
                ownership stay unchanged.
              </p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Deal</th>
                    <th>Quantity / sold</th>
                    <th>Allocated cost</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((i) => {
                    const sold = activeEntries(data.events)
                      .flatMap((e) => e.soldItems ?? [])
                      .filter((s) => s.itemId === i.id)
                      .reduce((n, s) => n + s.quantity, 0);
                    return (
                      <tr key={i.id}>
                        <td>
                          <strong>{i.name}</strong>
                          <small>
                            {[i.kind, i.variant, i.grade, i.certification]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </td>
                        <td>
                          {data.deals.find((d) => d.id === i.deal_id)?.name}
                        </td>
                        <td>
                          {i.quantity} / {sold}
                        </td>
                        <td>{money(i.cost_cents)}</td>
                        <td>
                          {data.admin && i.kind === "lot" && !sold && (
                            <button
                              className="secondary"
                              onClick={() => setParent(i.id)}
                            >
                              Break down lot
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!leaves.length && (
                <p className="empty">
                  Add a deal or import your ledger to start tracking inventory.
                </p>
              )}
            </div>
          </section>
          {parent && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  Break down {inventory.find((i) => i.id === parent)?.name}
                </h2>
                <button onClick={() => setParent("")}>Cancel</button>
              </div>
              <form
                className="panel-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    const p = inventory.find((i) => i.id === parent)!;
                    const cost = parseMoney(f.get("cost"));
                    if (cost > p.cost_cents)
                      throw new Error("Card cost exceeds remaining lot cost");
                    const children = [
                      inventorySchema.parse({
                        id: crypto.randomUUID(),
                        kind: "card",
                        name: f.get("name"),
                        variant: f.get("variant"),
                        grade: f.get("grade"),
                        certification: f.get("certification"),
                        quantity: Number(f.get("quantity")),
                        cost,
                        notes: "",
                      }),
                    ];
                    if (f.get("remainder") === "on")
                      children.push(
                        inventorySchema.parse({
                          id: crypto.randomUUID(),
                          kind: "lot",
                          name: p.name + " — remainder",
                          quantity: 1,
                          cost: p.cost_cents - cost,
                          notes: p.notes,
                        }),
                      );
                    else if (cost !== p.cost_cents)
                      throw new Error(
                        "Include a remainder lot or allocate the entire cost",
                      );
                    if (demo)
                      update({
                        ...data,
                        inventory: [
                          ...inventory,
                          ...children.map((i) => ({
                            ...i,
                            deal_id: p.deal_id,
                            parent_id: p.id,
                            cost_cents: i.cost,
                          })),
                        ],
                      });
                    else {
                      await post("/api/inventory", { parent, children });
                      await refresh();
                    }
                    setParent("");
                    setMessage(
                      "Inventory subdivided; purchase cost preserved.",
                    );
                  });
                }}
              >
                <div className="form-grid">
                  <label>
                    Card name
                    <input name="name" required />
                  </label>
                  <label>
                    Quantity
                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      step="1"
                      defaultValue="1"
                      required
                    />
                  </label>
                  <label>
                    Variant
                    <input name="variant" />
                  </label>
                  <label>
                    Grade
                    <input name="grade" />
                  </label>
                  <label>
                    Certification number
                    <input name="certification" />
                  </label>
                  <label>
                    Allocated purchase cost ($)
                    <input
                      name="cost"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                    />
                  </label>
                </div>
                <label className="check">
                  <input name="remainder" type="checkbox" defaultChecked />
                  Keep the rest as a remainder lot
                </label>
                <button className="primary" disabled={busy}>
                  Save inventory breakdown
                </button>
              </form>
            </section>
          )}
        </>
      )}
      {section === "reconciliation" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Agreed balances vs. reconstructed history</h2>
              <p>
                A checkpoint never changes debt. Positive differences mean the
                calculated debt is higher.
              </p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Relationship / date</th>
                    <th>Agreed</th>
                    <th>Calculated</th>
                    <th>Difference</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.checkpoints ?? []).map((c) => {
                    const calculated = balanceAt(
                        data.deals,
                        data.events,
                        c.as_of,
                        c.from_person,
                        c.to_person,
                      ),
                      diff = calculated - c.agreed_cents;
                    return (
                      <tr key={c.id}>
                        <td>
                          {people[c.from_person]} owes {people[c.to_person]}
                          <small>
                            {c.as_of} · {c.notes}
                          </small>
                        </td>
                        <td>{money(c.agreed_cents)}</td>
                        <td>{money(calculated)}</td>
                        <td>{money(diff)}</td>
                        <td>
                          <span className="tag">
                            {diff === 0
                              ? "Matched"
                              : Math.abs(diff) <= c.tolerance_cents
                                ? "Within tolerance"
                                : "Investigate"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!data.checkpoints?.length && (
                <p className="empty">No agreed balance checkpoints yet.</p>
              )}
            </div>
          </section>
          {data.admin && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Add an agreed balance checkpoint</h2>
              </div>
              <form
                className="panel-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    const checkpoint = checkpointSchema.parse({
                      from_person: f.get("from"),
                      to_person: f.get("to"),
                      as_of: f.get("date"),
                      agreed_cents: parseMoney(f.get("agreed")),
                      tolerance_cents: parseMoney(f.get("tolerance")),
                      notes: f.get("notes"),
                    });
                    if (demo)
                      update({
                        ...data,
                        checkpoints: [
                          ...(data.checkpoints ?? []),
                          { ...checkpoint, id: crypto.randomUUID() },
                        ],
                      });
                    else {
                      await post("/api/checkpoints", checkpoint);
                      await refresh();
                    }
                    setMessage(
                      "Checkpoint saved. Financial balances were not changed.",
                    );
                  });
                }}
              >
                <div className="form-grid">
                  <label>
                    Who owes
                    <select name="from">
                      {ids.map((p) => (
                        <option key={p} value={p}>
                          {people[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Owed to
                    <select name="to" defaultValue="1of1">
                      {ids.map((p) => (
                        <option key={p} value={p}>
                          {people[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    As-of date
                    <input type="date" name="date" required />
                  </label>
                  <label>
                    Agreed balance ($)
                    <input
                      name="agreed"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Acceptable difference ($)
                    <input
                      name="tolerance"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue="0"
                      required
                    />
                  </label>
                  <label>
                    Notes
                    <input
                      name="notes"
                      required
                      placeholder="Agreed over text on…"
                    />
                  </label>
                </div>
                <button className="primary" disabled={busy}>
                  Save checkpoint
                </button>
              </form>
            </section>
          )}
        </>
      )}
      {section === "import" && data.admin && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Import historical records</h2>
            <p>Preview first. The entire reviewed batch saves together.</p>
          </div>
          <div className="panel-body">
            <p>
              Supports your original deal-ledger and unrelated-payment CSV
              formats. General payment CSVs can also use:{" "}
              <code>Type,Date,Amount,From,To,Notes,Reference</code>. Types:
              payment, on_behalf, adjustment.
            </p>
            <p>
              For purchase funding and sale receipts, use{" "}
              <code>
                Type,Date,Amount,Payer,Received_by,deal_id,Notes,Fees,Final,Reference
              </code>
              . Type is <code>purchase_funding</code> or{" "}
              <code>sale_receipt</code>. Use the stable deal ID. Funding
              identifies the partner who paid; receipts require the partner who
              received the money in Received_by. Payer may describe an external
              buyer for receipts. Mark only the last receipt Final=true. Each
              receipt is part of the sale total; do not also import a separate
              full-sale amount.
            </p>
            <p>
              To classify eBay transactions, add <code>Source</code> (ebay) and{" "}
              <code>Source_category</code> (shared_payout, personal_payout,
              pass_through, refund, purchase, or forwarded). Forwarded payments
              require <code>Payout_entry_id</code>, the existing incoming
              pass-through entry ID. Optional <code>Payout_group</code> groups
              incoming allocations of one deposit. Notes alone do not classify a
              payout.
            </p>
            <label>
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setPreview(null);
                  if (file) {
                    setFilename(file.name);
                    if (file.size > 2000000) {
                      setError("File must be under 2 MB");
                      setCsv("");
                      return;
                    }
                    void file.text().then(setCsv);
                  }
                }}
              />
            </label>
            <label>
              Who collected sales in this file?
              <select
                value={collector}
                onChange={(e) => {
                  setCollector(e.target.value as PersonId);
                  setPreview(null);
                }}
              >
                {ids.map((p) => (
                  <option key={p} value={p}>
                    {people[p]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={busy || !csv}
              onClick={() =>
                void run(async () => {
                  setPreview(
                    demo
                      ? previewImport(csv, data, collector)
                      : await post("/api/import", {
                          filename,
                          text: csv,
                          collector,
                          commit: false,
                        }),
                  );
                })
              }
            >
              Preview import
            </button>
            {preview && (
              <>
                <h3>
                  {preview.deals.length} deals · {preview.events.length}{" "}
                  transactions
                </h3>
                {preview.warnings.map((w, i) => (
                  <p className="form-hint" key={i}>
                    {w}
                  </p>
                ))}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Participants</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.deals.map((d) => (
                        <tr key={d.id}>
                          <td>{d.name}</td>
                          <td>{d.acquired}</td>
                          <td>{money(d.cost)}</td>
                          <td>
                            {d.members.map((m) => people[m.person]).join(", ")}
                          </td>
                        </tr>
                      ))}
                      {preview.events.map((e) => (
                        <tr key={e.id}>
                          <td>
                            {e.kind}
                            <small>{e.notes}</small>
                          </td>
                          <td>{e.date}</td>
                          <td>{money(e.amount)}</td>
                          <td>
                            {people[e.from]}
                            {e.to ? " → " + people[e.to] : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Review the amounts, people, dates, and assumptions above.
                  These records will affect balances.
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (demo)
                        update({
                          ...data,
                          deals: [...data.deals, ...preview.deals],
                          events: [...data.events, ...preview.events],
                        });
                      else {
                        await post("/api/import", {
                          filename,
                          text: csv,
                          collector,
                          commit: true,
                        });
                        await refresh();
                      }
                      setPreview(null);
                      setCsv("");
                      setMessage(
                        "Historical records imported. Compare the resulting balances in Reconciliation.",
                      );
                    })
                  }
                >
                  Confirm and import records
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
