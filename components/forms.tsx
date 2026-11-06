"use client";
import { useState } from "react";
import {
  Data,
  Deal,
  Entry,
  ids,
  people,
  PersonId,
  parseMoney,
  dealSchema,
  eventSchema,
  money,
} from "@/lib/model";
import { type DealCreation } from "@/lib/deal-creation";
import { kindNames } from "@/lib/labels";
import { activeEntries } from "@/lib/ledger";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Puerto_Rico",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function DealForm({
  save,
}: {
  save: (d: DealCreation) => Promise<void>;
}) {
  const [selected, setSelected] = useState<PersonId[]>(["dread", "1of1"]),
    [equal, setEqual] = useState(true),
    [purchasePrice, setPurchasePrice] = useState(""),
    [costs, setCosts] = useState<
      { id: string; amount: string; custom: boolean }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const f = new FormData(e.currentTarget);
          const d = dealSchema.parse({
            id: crypto.randomUUID(),
            name: f.get("name"),
            source: f.get("source"),
            variant: f.get("variant"),
            grade: f.get("grade"),
            acquired: f.get("acquired"),
            cost: parseMoney(f.get("cost")),
            notes: f.get("notes"),
            items: f.get("items"),
            inventory: [
              {
                id: crypto.randomUUID(),
                kind: f.get("inventoryKind"),
                name: f.get("name"),
                variant: f.get("variant"),
                grade: f.get("grade"),
                quantity: Number(f.get("quantity")),
                cost: parseMoney(f.get("cost")),
                notes: f.get("items"),
              },
            ],
            members: selected.map((person) => ({
              person,
              weight: equal ? 1 : Number(f.get("weight-" + person)),
              funded: parseMoney(f.get("funded-" + person)),
            })),
          });
          const expenses = costs.map((row) =>
            eventSchema.parse({
              id: row.id,
              dealId: d.id,
              kind: "expense",
              date: f.get(`expense-date-${row.id}`) || d.acquired,
              amount: parseMoney(f.get(`expense-amount-${row.id}`)),
              from: f.get(`expense-payer-${row.id}`),
              to: null,
              notes: f.get(`expense-notes-${row.id}`),
              allocations: row.custom
                ? selected
                    .map((person) => ({
                      person,
                      weight: Number(
                        f.get(`expense-share-${row.id}-${person}`),
                      ),
                    }))
                    .filter((a) => a.weight > 0)
                : undefined,
            }),
          );
          await save({ ...d, expenses });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unable to save");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <label className="span2">
          Deal name
          <input
            name="name"
            required
            placeholder="e.g. October Pokémon collection"
          />
        </label>
        <label>
          Acquisition date
          <input type="date" name="acquired" defaultValue={today()} required />
        </label>
        <label>
          Purchase price ($)
          <input
            name="cost"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value)}
          />
        </label>
        <label>
          Source / seller
          <input name="source" defaultValue="" />
        </label>
        <label>
          Grade
          <input name="grade" placeholder="BGS 8.5 / mixed" defaultValue="" />
        </label>
        <label className="span2">
          Variant
          <input name="variant" defaultValue="" />
        </label>
        <label>
          Inventory type
          <select name="inventoryKind">
            <option value="lot">Collection / lot</option>
            <option value="card">Individual card</option>
          </select>
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
        <label className="span2">
          Cards / collection inventory
          <textarea
            name="items"
            required
            placeholder="One card per line, or describe the entire lot"
          />
        </label>
      </div>
      <h3>Ownership & funding</h3>
      <p className="muted">
        Funding must add up to the purchase price. Unfunded shares become debts
        immediately. Enter purchase payments here; record travel and other costs
        below.
      </p>
      <div className="chips">
        {ids.map((p) => (
          <label
            key={p}
            className={selected.includes(p) ? "chip active" : "chip"}
          >
            <input
              type="checkbox"
              checked={selected.includes(p)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, p]
                    : selected.filter((x) => x !== p),
                )
              }
            />
            {people[p]}
          </label>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={equal}
          onChange={(e) => setEqual(e.target.checked)}
        />
        Equal ownership split
      </label>
      {selected.map((p) => (
        <div className="fund-row" key={p}>
          <strong>{people[p]}</strong>
          {!equal && (
            <label>
              Ownership units
              <input
                name={"weight-" + p}
                type="number"
                min="1"
                step="1"
                defaultValue="1"
                required
              />
            </label>
          )}
          <label>
            Paid ($)
            <input
              name={"funded-" + p}
              type="number"
              step="0.01"
              min="0"
              defaultValue="0"
              required
            />
          </label>
        </div>
      ))}
      <section aria-label="Additional costs">
        <h3>Additional costs</h3>
        <p className="muted">
          Record paid expenses such as flights, hotels, shipping, or payment
          fees. Each cost is shared by ownership unless you choose a custom
          split.
        </p>
        {costs.map((row, index) => (
          <fieldset
            key={row.id}
            style={{
              margin: "16px 0",
              padding: 16,
              minWidth: 0,
              border: "1px solid var(--line)",
              borderRadius: 8,
            }}
          >
            <legend>Expense {index + 1}</legend>
            <div className="form-grid">
              <label className="span2">
                Purpose
                <input
                  name={`expense-notes-${row.id}`}
                  required
                  maxLength={5000}
                  placeholder="e.g. Flights for collection pickup"
                />
              </label>
              <label>
                Amount ($)
                <input
                  name={`expense-amount-${row.id}`}
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={row.amount}
                  onChange={(e) =>
                    setCosts(
                      costs.map((c) =>
                        c.id === row.id ? { ...c, amount: e.target.value } : c,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Paid by
                <select name={`expense-payer-${row.id}`} required>
                  {selected.map((p) => (
                    <option key={p} value={p}>
                      {people[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span2">
                Payment date (defaults to acquisition date)
                <input type="date" name={`expense-date-${row.id}`} />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={row.custom}
                onChange={(e) =>
                  setCosts(
                    costs.map((c) =>
                      c.id === row.id ? { ...c, custom: e.target.checked } : c,
                    ),
                  )
                }
              />
              Custom expense split
            </label>
            {row.custom &&
              selected.map((p) => (
                <label key={p}>
                  {people[p]} allocation units (0 excludes)
                  <input
                    name={`expense-share-${row.id}-${p}`}
                    type="number"
                    min="0"
                    max="1000000"
                    step="1"
                    defaultValue="1"
                    required
                  />
                </label>
              ))}
            <button
              type="button"
              onClick={() => setCosts(costs.filter((c) => c.id !== row.id))}
            >
              Remove expense {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={costs.length >= 50}
          onClick={() =>
            setCosts([
              ...costs,
              { id: crypto.randomUUID(), amount: "", custom: false },
            ])
          }
        >
          Add expense
        </button>
        <p>
          Additional costs:{" "}
          <strong>
            {money(
              costs.reduce(
                (sum, c) => sum + Math.round((Number(c.amount) || 0) * 100),
                0,
              ),
            )}
          </strong>
        </p>
        <p>
          Total deal cost:{" "}
          <strong>
            {money(
              Math.round((Number(purchasePrice) || 0) * 100) +
                costs.reduce(
                  (sum, c) => sum + Math.round((Number(c.amount) || 0) * 100),
                  0,
                ),
            )}
          </strong>
        </p>
      </section>
      <label>
        Notes
        <textarea name="notes" defaultValue="" />
      </label>
      <p className="error" role="alert">
        {error}
      </p>
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : "Create deal"}
      </button>
    </form>
  );
}
export function EntryForm({
  data,
  initialDeal,
  save,
}: {
  data: Data;
  initialDeal?: string;
  save: (e: Entry) => Promise<void>;
}) {
  const [kind, setKind] = useState<Entry["kind"]>(
      initialDeal ? "sale" : "on_behalf",
    ),
    [dealId, setDealId] = useState(initialDeal ?? data.deals[0]?.id ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dealKind = [
      "purchase_funding",
      "sale",
      "expense",
      "funding_repayment",
      "distribution",
    ].includes(kind),
    deal = data.deals.find((d) => d.id === dealId),
    choices = dealKind ? (deal?.members.map((m) => m.person) ?? []) : [...ids];
  const [customExpense, setCustomExpense] = useState(false);
  const [saleMode, setSaleMode] = useState("new");
  const saleOptions = activeEntries(data.events).filter(
    (e) => e.dealId === dealId && e.saleTerms,
  );
  const inventory = (
    data.inventory ??
    data.deals.flatMap((d) =>
      (d.inventory ?? [{ id: d.id, name: d.name, quantity: 1 }]).map((i) => ({
        ...i,
        deal_id: d.id,
        parent_id: null,
      })),
    )
  ).filter(
    (i) =>
      i.deal_id === dealId &&
      !(data.inventory ?? []).some((c) => c.parent_id === i.id),
  );
  const hasTo = !["sale", "expense", "purchase_funding"].includes(kind);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const f = new FormData(e.currentTarget);
          await save(
            eventSchema.parse({
              id: crypto.randomUUID(),
              dealId: dealKind ? dealId : null,
              kind,
              date: f.get("date"),
              amount: parseMoney(f.get("amount")),
              fees: kind === "sale" ? parseMoney(f.get("fees")) : 0,
              from: f.get("from"),
              to: hasTo ? f.get("to") : null,
              notes: f.get("notes"),
              reference: String(f.get("reference") ?? ""),
              saleTerms:
                kind === "sale" && saleMode === "new"
                  ? {
                      total: parseMoney(f.get("saleTotal")),
                      fees: parseMoney(f.get("saleFees")),
                    }
                  : undefined,
              saleId:
                kind === "sale" && saleMode === "installment"
                  ? String(f.get("saleId"))
                  : undefined,
              receiptUrl: String(f.get("receiptUrl") ?? "").trim() || undefined,
              allocations:
                kind === "expense" && customExpense
                  ? choices
                      .map((person) => ({
                        person,
                        weight: Number(f.get("allocation-" + person)),
                      }))
                      .filter((a) => a.weight > 0)
                  : undefined,
              soldItems:
                kind === "sale" && saleMode !== "installment"
                  ? inventory
                      .map((i) => ({
                        itemId: i.id,
                        quantity: Number(f.get("sold-" + i.id)),
                      }))
                      .filter((i) => i.quantity > 0)
                  : undefined,
              close: kind === "sale" && f.get("close") === "on",
              target: null,
            }),
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unable to save");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Transaction type
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Entry["kind"])}
        >
          {Object.entries(kindNames)
            .filter(
              ([k]) =>
                ![
                  "void",
                  "ownership_correction",
                  "credit_sale",
                  "purchase_obligation",
                  "funding_repayment",
                  "distribution",
                  "opening",
                ].includes(k),
            )
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
      </label>
      <p className="form-hint">
        {kind === "sale"
          ? "Record the agreed total on the sale date, even if nothing has been received yet. Link later receipts as installments. Close the deal only after all inventory is sold and all installments are received."
          : kind === "purchase_funding"
            ? "Records money paid toward a payment-tracked purchase. Other owners owe their shares immediately. Record additional costs separately as expenses."
            : kind === "funding_repayment"
              ? "Repays a purchase share and transfers the right to recover that funding to the payer."
              : kind === "distribution"
                ? "Records money actually transferred for this deal. Select the payer and recipient."
                : ["opening", "adjustment"].includes(kind)
                  ? "Adds an explicit debt adjustment: the first person owes the second. Explain the discrepancy in the notes. Use reconciliation checkpoints to compare agreed balances without changing debt."
                  : kind === "expense"
                    ? "Adds a shared cost funded by the selected participant."
                    : kind === "on_behalf"
                      ? "Credits the payer against the person they paid for. It does not reimburse funding on a specific deal."
                      : "Reduces the running balance between two people. Add a note explaining the payment; no deal allocation is needed."}
      </p>
      {dealKind && (
        <label>
          Deal
          <select
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            required
          >
            <option value="" disabled>
              Select a deal
            </option>
            {data.deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form-grid">
        <label>
          Date
          <input name="date" type="date" defaultValue={today()} required />
        </label>
        <label>
          {kind === "sale"
            ? "Sale receipt amount before fees ($)"
            : "Amount ($)"}
          <input
            name="amount"
            type="number"
            min={kind === "sale" ? "0" : "0.01"}
            step="0.01"
            required
          />
        </label>
        <label>
          {kind === "sale"
            ? "Received by"
            : ["opening", "adjustment"].includes(kind)
              ? "Who owes"
              : "Paid by"}
          <select name="from" required key={"from" + dealId + kind}>
            {choices.map((p) => (
              <option key={p} value={p}>
                {people[p]}
              </option>
            ))}
          </select>
        </label>
        {hasTo && (
          <label>
            {["opening", "adjustment"].includes(kind)
              ? "Owed to"
              : kind === "on_behalf"
                ? "Paid for"
                : "Paid to"}
            <select
              name="to"
              required
              key={"to" + dealId + kind}
              defaultValue={choices[1]}
            >
              {choices.map((p) => (
                <option key={p} value={p}>
                  {people[p]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "sale" && (
          <label>
            Fees ($)
            <input
              name="fees"
              type="number"
              step="0.01"
              min="0"
              defaultValue="0"
              required
            />
          </label>
        )}
      </div>
      {kind === "sale" && (
        <fieldset>
          <legend>Sale details</legend>
          <label>
            Record
            <select
              value={saleMode}
              onChange={(e) => setSaleMode(e.target.value)}
            >
              <option value="new">New sale</option>
              <option value="installment">
                Installment for an existing sale
              </option>
              <option value="legacy">
                Historical receipt — sale details unknown
              </option>
            </select>
          </label>
          {saleMode === "new" && (
            <>
              <p>
                The date above is the sale date. Enter only cash received on
                that date in the receipt amount; use zero if unpaid.
              </p>
              <label>
                Agreed sale total before fees ($)
                <input
                  name="saleTotal"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </label>
              <label>
                Total sale fees ($)
                <input
                  name="saleFees"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  required
                />
              </label>
            </>
          )}
          {saleMode === "installment" && (
            <label>
              Original sale
              <select name="saleId" required key={dealId}>
                <option value="">Select a sale</option>
                {saleOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.date} · {money(e.saleTerms!.total)} · {e.notes}
                  </option>
                ))}
              </select>
            </label>
          )}
          {saleMode === "legacy" && (
            <p>
              Realized P/L and buyer balance remain incomplete until sale
              details are linked.
            </p>
          )}
        </fieldset>
      )}
      {kind === "expense" && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={customExpense}
              onChange={(e) => setCustomExpense(e.target.checked)}
            />
            Custom expense split
          </label>
          {customExpense &&
            choices.map((p) => (
              <label key={p}>
                {people[p]} allocation units (0 excludes)
                <input
                  name={"allocation-" + p}
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={
                    deal?.members.find((m) => m.person === p)?.weight ?? 1
                  }
                />
              </label>
            ))}
        </>
      )}
      {kind === "sale" &&
        saleMode !== "installment" &&
        inventory.length > 0 && (
          <>
            <h3>Inventory sold</h3>
            <p className="muted">
              Enter quantities sold on this date. Leave zero when item details
              are unknown; P/L will be marked incomplete.
            </p>
            {inventory.map((i) => (
              <label key={i.id}>
                {i.name}
                <input
                  name={"sold-" + i.id}
                  type="number"
                  min="0"
                  max={i.quantity}
                  step="1"
                  defaultValue="0"
                />
              </label>
            ))}
          </>
        )}
      <label>
        Receipt / supporting document link (optional)
        <input name="receiptUrl" type="url" placeholder="https://…" />
      </label>
      <label>
        Payment / sale reference (optional)
        <input name="reference" placeholder="PayPal reference, order number…" />
      </label>
      {kind === "sale" && (
        <label className="check">
          <input type="checkbox" name="close" />
          Close deal — no inventory or unpaid installments remain
        </label>
      )}
      <label>
        {kind === "sale"
          ? "Cards sold / transaction notes"
          : "Description / reference"}
        <textarea
          name="notes"
          required
          placeholder="What was this transaction for?"
        />
      </label>
      <p className="error" role="alert">
        {error}
      </p>
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : "Record transaction"}
      </button>
    </form>
  );
}
