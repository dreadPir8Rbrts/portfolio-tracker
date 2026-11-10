"use client";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Layers,
  ArrowLeftRight,
  Users,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Download,
  Search,
  X,
  LogOut,
  ChevronRight,
  Wallet,
  ShieldCheck,
  FlaskConical,
} from "lucide-react";
import { Data, Deal, Entry, PersonId, people, ids, money } from "@/lib/model";
import { prepareDealCreation, type DealCreation } from "@/lib/deal-creation";
import { kindNames } from "@/lib/labels";
import {
  activeEntries,
  balances,
  project,
  validateEntry,
  prepareEntry,
} from "@/lib/ledger";
import { salePerformance } from "@/lib/sales";
import { collectedProceeds } from "@/lib/collected-proceeds";
import { DealForm, EntryForm } from "./forms";
import Records from "./records";
import GradingPanel from "./grading";
import { GradingRequest, prepareGrading } from "@/lib/grading";
import BalanceStatement from "./balance-statement";
import MetricBreakdown from "./metric-breakdown";
import { MetricKind } from "@/lib/metric-breakdown";
import EbayPayouts from "./ebay-payouts";
import { sourceCategories } from "@/lib/ebay-payouts";
import { browserClient } from "@/lib/browser";
type Tab =
  | "overview"
  | "personal"
  | "deals"
  | "activity"
  | "people"
  | "records"
  | "grading";
const date = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function exportCsv(rows: unknown[][]) {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const blob = new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ninjadex-ledger-statement.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
export default function Portal({
  demo,
  initialData,
}: {
  demo: boolean;
  initialData?: Data;
}) {
  const [data, setData] = useState<Data | null>(initialData ?? null),
    [tab, setTab] = useState<Tab>("overview"),
    [view, setView] = useState<PersonId>("dread"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [metric, setMetric] = useState<{
      kind: MetricKind;
      person?: PersonId;
    } | null>(null),
    [statement, setStatement] = useState<{
      person: PersonId;
      partner: PersonId;
    } | null>(null),
    [modal, setModal] = useState<"deal" | "entry" | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  async function refresh() {
    const res = await fetch("/api/data", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    setData(body);
    setView(body.person);
    if (!body.admin) setTab((t) => (t === "overview" ? "personal" : t));
  }
  useEffect(() => {
    if (!demo) refresh().catch((e) => setError(e.message));
  }, [demo]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  async function save(kind: "deal" | "entry", value: DealCreation | Entry) {
    if (!data) return;
    if (kind === "entry")
      validateEntry(value as Entry, data.deals, data.events);
    if (demo) {
      const creation =
        kind === "deal"
          ? prepareDealCreation(value, data.deals, data.events)
          : null;
      setData({
        ...data,
        deals: creation ? [...data.deals, creation.deal] : data.deals,
        events: creation
          ? [...data.events, ...creation.entries]
          : [
              ...data.events,
              prepareEntry(
                value as Entry,
                data.deals,
                data.events,
                data.inventory,
              ),
            ],
      });
    } else {
      const res = await fetch(kind === "deal" ? "/api/deals" : "/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await refresh();
    }
    setModal(null);
    setNotice(
      kind === "deal"
        ? "Deal created. Ownership, funding, and additional costs recorded."
        : "Transaction recorded. Balances updated.",
    );
  }
  async function saveGrading(request: GradingRequest) {
    if (!data) return;
    const prepared = prepareGrading(request, data);
    if (demo) {
      setData({
        ...data,
        events: prepared.expense
          ? [...data.events, prepared.expense]
          : data.events,
        grading: [
          ...(data.grading ?? []).filter(
            (g) => g.id !== prepared.submission.id,
          ),
          { ...prepared.submission, version: prepared.expected_version + 1 },
        ],
      });
    } else {
      const res = await fetch("/api/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      await refresh();
    }
    setNotice("Grading submission saved. Any paid expense is linked once.");
  }
  const admin = data?.admin ?? false;
  if (!data)
    return (
      <main className="loading">
        <span className="brand">◈ NINJADEX LEDGER</span>
        <h1>{error ? "Account setup needed" : "Opening your portfolio…"}</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <p>
              The database migration and account mapping must be configured
              before live access.
            </p>
            <a href="/demo">Open example portfolio</a> ·{" "}
            <a href="/login">Back to sign in</a>
          </>
        )}
      </main>
    );
  const personal = tab === "personal" || !admin;
  const visibleDeals = personal
    ? data.deals.filter((d) => d.members.some((m) => m.person === view))
    : data.deals;
  const states = visibleDeals.map((d) => ({ d, s: project(d, data.events) }));
  const edges = balances(data.deals, data.events).filter(
    (e) => !personal || e.from === view || e.to === view,
  );
  const due = edges
      .filter((e) => e.to === view)
      .reduce((s, e) => s + e.amount, 0),
    owe = edges
      .filter((e) => e.from === view)
      .reduce((s, e) => s + e.amount, 0);
  const cost = states.reduce(
    (s, { d, s: state }) =>
      s + (personal ? state.costShares[view] : state.cost),
    0,
  );
  const performance = visibleDeals.map((d) =>
    salePerformance(d, data.events, data.inventory),
  );
  const profit = performance.reduce(
    (n, p) => n + (personal ? p.shares[view] : p.profit),
    0,
  );
  const incomplete = performance.reduce((n, p) => n + p.incomplete, 0);
  const receivedProceeds = collectedProceeds(visibleDeals, data.events);
  const chosen = data.deals.find((d) => d.id === selected),
    chosenState = chosen ? project(chosen, data.events) : null;
  const chosenSales = chosen
    ? salePerformance(chosen, data.events, data.inventory)
    : null;
  const nav = [
    { id: "records" as Tab, label: "Records & reconciliation", icon: Layers },
    ...(admin
      ? [
          {
            id: "overview" as Tab,
            label: "Portfolio overview",
            icon: LayoutDashboard,
          },
        ]
      : []),
    { id: "personal" as Tab, label: "My dashboard", icon: Wallet },
    { id: "deals" as Tab, label: "Deals & inventory", icon: Layers },
    { id: "activity" as Tab, label: "Transactions", icon: ArrowLeftRight },
    { id: "grading" as Tab, label: "Grading", icon: ShieldCheck },
    ...(admin ? [{ id: "people" as Tab, label: "Partners", icon: Users }] : []),
  ];
  const activity = data.events.filter(
    (e) =>
      !personal ||
      (e.dealId
        ? data.deals.some(
            (d) =>
              d.id === e.dealId && d.members.some((m) => m.person === view),
          )
        : e.from === view || e.to === view),
  );
  const reversed = new Set(
    data.events.filter((e) => e.kind === "void").map((e) => e.target),
  );
  function exportStatement() {
    exportCsv([
      [
        "Date",
        "Type",
        "Deal",
        "From / collector",
        "To",
        "Amount USD",
        "Fees USD",
        "Notes",
        "Status",
      ],
      ...activity.map((e) => [
        e.date,
        kindNames[e.kind],
        data!.deals.find((d) => d.id === e.dealId)?.name ?? "",
        people[e.from],
        e.to ? people[e.to] : "",
        (e.amount / 100).toFixed(2),
        (e.fees / 100).toFixed(2),
        e.notes,
        reversed.has(e.id) ? "Reversed" : "Recorded",
      ]),
    ]);
  }
  async function reverse(e: Entry) {
    const reason = window.prompt(
      "Reason for reversing this entry (the original will remain visible):",
    );
    if (!reason?.trim()) return;
    try {
      await save("entry", {
        ...e,
        id: crypto.randomUUID(),
        kind: "void",
        amount: 0,
        fees: 0,
        close: false,
        target: e.id,
        notes: reason,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reverse");
    }
  }
  const activityTable = (entries: Entry[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>People / deal</th>
            <th>Date</th>
            <th className="right">Amount</th>
            {admin && <th />}
          </tr>
        </thead>
        <tbody>
          {[...entries].reverse().map((e) => (
            <tr key={e.id} className={reversed.has(e.id) ? "reversed" : ""}>
              <td>
                <strong>
                  {kindNames[e.kind]}{" "}
                  {reversed.has(e.id) && <span className="tag">Reversed</span>}
                </strong>
                <small>{e.notes}</small>
                {e.source === "ebay" && e.sourceCategory && (
                  <small>eBay · {sourceCategories[e.sourceCategory]}</small>
                )}
                {e.receiptUrl && (
                  <a
                    href={e.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                  >
                    Receipt / document ↗
                  </a>
                )}
              </td>
              <td>
                {people[e.from]}
                {e.to ? " → " + people[e.to] : ""}
                <small>
                  {data.deals.find((d) => d.id === e.dealId)?.name ??
                    "Personal balance"}
                </small>
              </td>
              <td className="nowrap">{date(e.date)}</td>
              <td className="right amount">
                {money(e.amount)}
                {e.fees > 0 && <small>{money(e.fees)} fees</small>}
              </td>
              {admin && (
                <td>
                  {e.kind !== "void" &&
                    ![
                      "purchase_obligation",
                      "ownership_correction",
                      "credit_sale",
                    ].includes(e.kind) &&
                    !reversed.has(e.id) && (
                      <button
                        className="text-button"
                        onClick={() => reverse(e)}
                      >
                        Reverse
                      </button>
                    )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!entries.length && <div className="empty">No transactions yet.</div>}
    </div>
  );
  const dealTable = () => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Collection / card</th>
            <th>Partners</th>
            <th>Acquired</th>
            <th className="right">Purchase price</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visibleDeals
            .filter((d) =>
              (d.name + " " + d.source + " " + d.items)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((d, i) => {
              const s = project(d, data.events);
              return (
                <tr key={d.id}>
                  <td>
                    <button
                      className="deal-link"
                      onClick={() => setSelected(d.id)}
                    >
                      <span className={"mini-card c" + i}>◈</span>
                      <span>
                        <strong>{d.name}</strong>
                        <small>
                          {[d.variant, d.grade].filter(Boolean).join(" · ") ||
                            "Collection"}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <div className="avatars">
                      {d.members.map((m) => (
                        <span
                          className={"avatar " + m.person}
                          key={m.person}
                          title={people[m.person]}
                        >
                          {people[m.person].slice(0, 1)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="nowrap">{date(d.acquired)}</td>
                  <td className="right amount">{money(d.cost)}</td>
                  <td>
                    <span className={"tag " + (s.closed ? "sold" : "held")}>
                      {s.closed
                        ? "Sold"
                        : s.proceeds
                          ? "Partially sold"
                          : "Held"}
                    </span>
                  </td>
                  <td>
                    <button
                      aria-label={"View " + d.name}
                      className="icon-button"
                      onClick={() => setSelected(d.id)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {!visibleDeals.length && (
        <div className="empty">
          <Layers />
          <h3>Your next collection starts here.</h3>
          <p>
            {admin
              ? "Add a deal to track ownership, funding, and every sale."
              : "Shared deals will appear here once Joey adds you."}
          </p>
          {admin && (
            <button className="primary" onClick={() => setModal("deal")}>
              Add your first deal
            </button>
          )}
        </div>
      )}
    </div>
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href={demo ? "/demo" : "/"}>
          <span className="brand-mark">◈</span>
          <span>
            NINJADEX<span className="brand-sub">LEDGER</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">D</span>
          <div>
            Collection workspace
            <small>{admin ? "Administrator" : "Partner access"}</small>
          </div>
          <ShieldCheck size={16} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(n.id);
                setStatement(null);
                setMetric(null);
                setSelected(null);
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "deals" && (
                <span className="nav-count">{data.deals.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="ledger-note">
            <ShieldCheck size={20} />
            <strong>Clarity in every split.</strong>
            <p>Ownership, funding, and payments in one place.</p>
          </div>
          <div className="user">
            <span className="avatar dread">{people[data.person][0]}</span>
            <div>
              {people[data.person]}
              <small>{admin ? "Admin" : "Partner"}</small>
            </div>
            {!demo && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  await browserClient().auth.signOut();
                  window.location.href = "/login";
                }}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <span>{nav.find((n) => n.id === tab)?.label}</span>
          </div>
          <span className="private-label">
            <span />
            Private workspace
          </span>
        </header>
        {demo && (
          <div className="demo-banner">
            <FlaskConical size={16} />
            <span>
              Example portfolio · Changes last until you reload. No live records
              are modified.
            </span>
            <a href="/login">Live sign in →</a>
          </div>
        )}
        <main className="content">
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              {notice}
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {selected
                  ? "DEAL DETAILS"
                  : tab === "personal"
                    ? "YOUR SHARE, AT A GLANCE"
                    : "THE COLLECTION, CONNECTED"}
              </span>
              <h1>
                {selected
                  ? chosen?.name
                  : metric
                    ? metric.kind === "proceeds"
                      ? "Net sale proceeds breakdown"
                      : "Realized profit / loss breakdown"
                    : statement
                      ? "Balance breakdown"
                      : tab === "grading"
                        ? "Grading submissions"
                        : tab === "records"
                          ? "Records & reconciliation"
                          : tab === "overview"
                            ? "Portfolio overview"
                            : tab === "personal"
                              ? "My dashboard"
                              : tab === "deals"
                                ? "Deals & inventory"
                                : tab === "people"
                                  ? "Your partners"
                                  : "Transactions"}
              </h1>
              <p>
                {selected
                  ? "Ownership, funding, and the complete deal history."
                  : tab === "grading"
                    ? "Submission progress, grades, and grading costs across your deals."
                    : tab === "overview"
                      ? "A clear picture of your cards, capital, and partnerships."
                      : tab === "personal"
                        ? "Your collections, your balances, and where every dollar went."
                        : tab === "activity"
                          ? "Every movement of money, with a record you can follow."
                          : tab === "people"
                            ? "Shared collections. Individual relationships."
                            : "From the first purchase to the final payout."}
              </p>
            </div>
            <div className="heading-actions">
              {((!statement && !metric) || selected) && (
                <button className="secondary" onClick={exportStatement}>
                  <Download size={16} />
                  Export
                </button>
              )}
              {admin && (
                <>
                  <button
                    className="secondary"
                    onClick={() => setModal("entry")}
                  >
                    Record payment
                  </button>
                  <button className="primary" onClick={() => setModal("deal")}>
                    <Plus size={17} />
                    New deal
                  </button>
                </>
              )}
            </div>
          </div>
          {metric && !selected ? (
            <MetricBreakdown
              data={data}
              kind={metric.kind}
              person={metric.person}
              onBack={() => setMetric(null)}
              onDeal={setSelected}
            />
          ) : statement && !selected ? (
            <BalanceStatement
              data={data}
              person={statement.person}
              partner={statement.partner}
              onBack={() => setStatement(null)}
              onDeal={setSelected}
            />
          ) : selected && chosen && chosenState && chosenSales ? (
            <>
              <button
                className="text-button back"
                onClick={() => setSelected(null)}
              >
                ← Back to{" "}
                {metric
                  ? "metric breakdown"
                  : statement
                    ? "balance breakdown"
                    : tab === "grading"
                      ? "grading overview"
                      : "portfolio"}
              </button>
              <div className="stats">
                <Stat
                  label="Purchase + expenses"
                  value={money(chosenState.cost)}
                  caption={"Acquired " + date(chosen.acquired)}
                />
                <Stat
                  label="Net sale proceeds"
                  value={money(chosenState.proceeds)}
                  caption="After sale fees; credit-sale payments are recorded separately"
                />
                <Stat
                  label="Unrecovered funding"
                  value={money(chosenState.unrecovered)}
                  caption={
                    chosenState.closed
                      ? "Closed deal · loss allocated to owners"
                      : "Recovered before profit distributions"
                  }
                />
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Sales & realized P/L</h2>
                </div>
                <div className="panel-body">
                  <p>
                    Profit and loss are recognized on the sale date. Received
                    and still owed are buyer amounts before fees; partner
                    balances follow actual collections.
                  </p>
                  {chosenSales.incomplete > 0 && (
                    <p role="status">
                      Some sales need an agreed total or cost allocation. Totals
                      below include only calculable P/L.
                    </p>
                  )}
                  <p>
                    <strong>Realized P/L: {money(chosenSales.profit)}</strong> ·
                    Received: {money(chosenSales.received)}
                    {chosenSales.unknownReceived
                      ? " + unallocated partner payments"
                      : ""}{" "}
                    · Still owed: {money(chosenSales.owed)}
                    {chosenSales.unknownOwed ? " + unknown amounts" : ""}
                  </p>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Sale date / items</th>
                        <th className="right">Sale total</th>
                        <th className="right">Received</th>
                        <th className="right">Still owed</th>
                        <th className="right">Cost incl. expenses</th>
                        <th className="right">Realized P/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chosenSales.rows.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {date(s.date)}
                            <br />
                            {s.label}
                          </td>
                          <td className="right">
                            {s.total === null ? "Unknown" : money(s.total)}
                          </td>
                          <td className="right">
                            {s.received === null
                              ? "Partner ledger"
                              : money(s.received)}
                          </td>
                          <td className="right">
                            {s.owed === null ? "Unknown" : money(s.owed)}
                          </td>
                          <td className="right">
                            {s.cost === null
                              ? "Allocation needed"
                              : money(s.cost)}
                          </td>
                          <td className="right">
                            {s.profit === null ? "Incomplete" : money(s.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="detail-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Ownership & contributions</h2>
                    <span className="tag">
                      {chosen.members.length} partners
                    </span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Partner</th>
                        <th>Ownership</th>
                        <th className="right">Linked purchase payments</th>
                        <th className="right">Realized P/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...chosen.members,
                        ...(chosen.funders ?? [])
                          .filter(
                            (p) => !chosen.members.some((m) => m.person === p),
                          )
                          .map((person) => ({ person, weight: 0, funded: 0 })),
                      ].map((m) => (
                        <tr key={m.person}>
                          <td>{people[m.person]}</td>
                          <td>
                            {(
                              (100 * m.weight) /
                              chosen.members.reduce((s, x) => s + x.weight, 0)
                            ).toLocaleString("en-US", {
                              maximumFractionDigits: 2,
                            })}
                            %
                          </td>
                          <td className="right">
                            {money(chosenState.funded[m.person])}
                          </td>
                          <td className="right">
                            {money(chosenSales.shares[m.person])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="panel-body">
                    {chosen.fundingMode === "seller_credit" && (
                      <p>
                        This card was purchased on credit. Its purchase
                        obligation and repayments appear in the running balance.
                        Cost recovery here represents the buyer’s asset cost,
                        not an initial cash payment.
                      </p>
                    )}
                    <h3>Current deal settlement</h3>
                    {chosenState.edges.map((e, i) => (
                      <div className="balance-line" key={i}>
                        <span>
                          {people[e.from]} → {people[e.to]}
                        </span>
                        <strong>{money(e.amount)}</strong>
                      </div>
                    ))}
                    {!chosenState.edges.length && (
                      <p className="muted">All participants are settled.</p>
                    )}
                    <small>
                      Balances are consolidated within this deal. Personal
                      payments and other deals are included on your dashboard.
                    </small>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Inventory & notes</h2>
                  </div>
                  <div className="panel-body">
                    <span className="tag">
                      {chosenState.closed ? "Fully sold" : "Inventory remains"}
                    </span>
                    <p className="prewrap">{chosen.items}</p>
                    <dl>
                      <dt>Source</dt>
                      <dd>{chosen.source || "—"}</dd>
                      <dt>Variant / grade</dt>
                      <dd>
                        {[chosen.variant, chosen.grade]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </dd>
                    </dl>
                    <p className="muted">{chosen.notes}</p>
                    {admin && (
                      <button
                        className="primary"
                        onClick={() => setModal("entry")}
                      >
                        <Plus size={16} />
                        Record deal activity
                      </button>
                    )}
                  </div>
                </section>
              </div>
              <GradingPanel
                key={chosen.id}
                data={data}
                dealId={chosen.id}
                onDeal={setSelected}
                onSave={saveGrading}
              />
              <section className="panel">
                <div className="panel-heading">
                  <h2>Deal activity</h2>
                </div>
                {activityTable(
                  data.events.filter((e) => e.dealId === chosen.id),
                )}
              </section>
            </>
          ) : (
            <>
              {tab === "grading" && (
                <GradingPanel
                  data={data}
                  onDeal={setSelected}
                  onSave={saveGrading}
                />
              )}
              {(tab === "overview" || tab === "personal") && (
                <>
                  {tab === "personal" && admin && (
                    <label className="view-as">
                      View dashboard for
                      <select
                        value={view}
                        onChange={(e) => setView(e.target.value as PersonId)}
                      >
                        {ids.map((p) => (
                          <option key={p} value={p}>
                            {people[p]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className={personal ? "stats personal-stats" : "stats"}>
                    <Stat
                      label={
                        personal
                          ? "My allocated cost"
                          : "Total acquisition cost"
                      }
                      value={money(cost)}
                      caption={`${visibleDeals.length} deals across the portfolio`}
                      icon={<Layers size={18} />}
                    />
                    <Stat
                      label={personal ? "Owed to me" : "Unsold deals"}
                      value={
                        personal
                          ? money(due)
                          : String(states.filter((x) => !x.s.closed).length)
                      }
                      caption={
                        personal
                          ? "Across your partner relationships"
                          : "Held or partially sold"
                      }
                      icon={<ArrowDownLeft size={18} />}
                    />
                    <Stat
                      label={personal ? "I owe" : "Net sale proceeds"}
                      value={money(
                        personal
                          ? owe
                          : states.reduce((n, x) => n + x.s.proceeds, 0),
                      )}
                      caption={
                        personal ? "After recorded payments" : "After sale fees"
                      }
                      icon={<ArrowUpRight size={18} />}
                    />
                    {personal && (
                      <Stat
                        label="My net sale proceeds"
                        onClick={() =>
                          setMetric({ kind: "proceeds", person: view })
                        }
                        value={money(receivedProceeds.shares[view])}
                        caption="Your share of collected sales, after recorded fees"
                        icon={<ArrowDownLeft size={18} />}
                      />
                    )}
                    <Stat
                      label="Realized profit / loss"
                      onClick={() =>
                        setMetric({
                          kind: "profit",
                          person: personal ? view : undefined,
                        })
                      }
                      value={money(profit)}
                      caption={
                        incomplete
                          ? `Sale-date P/L · ${incomplete} sale(s) incomplete`
                          : "Recognized on sale date, including partial sales"
                      }
                      accent
                      icon={<Wallet size={18} />}
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Collection snapshot</h2>
                          <p>Your capital, from acquisition to sale.</p>
                        </div>
                        <span className="tag">USD</span>
                      </div>
                      <div className="snapshot">
                        <div className="snapshot-number">
                          {states.filter((x) => !x.s.closed).length}
                          <span>active collections</span>
                        </div>
                        <div className="portfolio-bar">
                          {states.map(({ d, s }, i) => (
                            <div
                              key={d.id}
                              style={{
                                flex: s.cost,
                                background: [
                                  "var(--chart-1)",
                                  "var(--chart-2)",
                                  "var(--chart-3)",
                                  "var(--chart-4)",
                                ][i % 4],
                              }}
                              title={d.name}
                            />
                          ))}
                        </div>
                        <div className="legend">
                          {states.map(({ d, s }, i) => (
                            <div key={d.id}>
                              <span
                                style={{
                                  background: [
                                    "var(--chart-1)",
                                    "var(--chart-2)",
                                    "var(--chart-3)",
                                    "var(--chart-4)",
                                  ][i % 4],
                                }}
                              />
                              {d.name}
                              <strong>{s.closed ? "Sold" : "Held"}</strong>
                            </div>
                          ))}
                          {!states.length && <p>No deals recorded yet.</p>}
                        </div>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            {personal ? "My balances" : "Partner balances"}
                          </h2>
                          <p>
                            Who owes whom, after offsets. Select a balance to
                            see its history.
                          </p>
                        </div>
                        <ArrowLeftRight size={19} />
                      </div>
                      <div className="panel-body">
                        {edges.map((e, i) => (
                          <button
                            type="button"
                            className="balance-line balance-button"
                            key={i}
                            aria-label={`View breakdown: ${people[e.from]} owes ${people[e.to]} ${money(e.amount)}`}
                            onClick={() =>
                              setStatement({
                                person: personal ? view : e.from,
                                partner:
                                  personal && e.from === view
                                    ? e.to
                                    : personal
                                      ? e.from
                                      : e.to,
                              })
                            }
                          >
                            <div>
                              <strong>{people[e.from]}</strong>
                              <small>owes {people[e.to]}</small>
                            </div>
                            <span className="amount">
                              {money(e.amount)}{" "}
                              <ChevronRight size={16} aria-hidden="true" />
                            </span>
                          </button>
                        ))}
                        {!edges.length && (
                          <div className="empty compact">
                            All square. No outstanding balances.
                          </div>
                        )}
                        {demo && (
                          <p className="footnote">
                            Example transactions only. Agreed opening balances
                            have not been entered.
                          </p>
                        )}
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === "personal" && (
                <EbayPayouts
                  key={view}
                  data={data}
                  person={view}
                  onDeal={setSelected}
                />
              )}
              {(tab === "overview" ||
                tab === "personal" ||
                tab === "deals") && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{tab === "deals" ? "All deals" : "Your deals"}</h2>
                      <p>Ownership and funding at a glance.</p>
                    </div>
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search deals"
                        placeholder="Search collections…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  {dealTable()}
                </section>
              )}
              {(tab === "activity" ||
                tab === "overview" ||
                tab === "personal") && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {tab === "activity"
                          ? "Transaction history"
                          : "Recent activity"}
                      </h2>
                      <p>Original records and reversals stay visible.</p>
                    </div>
                    {tab !== "activity" && (
                      <button
                        className="text-button"
                        onClick={() => setTab("activity")}
                      >
                        View all →
                      </button>
                    )}
                  </div>
                  {activityTable(
                    tab === "activity" ? activity : activity.slice(-5),
                  )}
                </section>
              )}
              {tab === "records" && (
                <Records
                  data={data}
                  demo={demo}
                  refresh={refresh}
                  update={setData}
                />
              )}
              {tab === "people" && (
                <div className="partner-grid">
                  {ids.map((p) => (
                    <section className="panel partner" key={p}>
                      <span className={"avatar large " + p}>
                        {people[p][0]}
                      </span>
                      <h2>{p}</h2>
                      <p className="partner-name">{people[p]}</p>
                      <span className="tag">
                        {p === data.person && data.admin
                          ? "Administrator"
                          : p === "1of1"
                            ? "Main partner"
                            : "Partner"}
                      </span>
                      <p>
                        {
                          data.deals.filter((d) =>
                            d.members.some((m) => m.person === p),
                          ).length
                        }{" "}
                        shared deals
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          setView(p);
                          setTab("personal");
                        }}
                      >
                        View dashboard <ArrowUpRight size={16} />
                      </button>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
          <footer>
            ◈ Ninjadex Ledger <span>Shared ownership. Clear records.</span>
          </footer>
        </main>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setModal(null);
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">
              {modal === "deal"
                ? "GROW THE COLLECTION"
                : "KEEP THE BOOKS CLEAR"}
            </span>
            <h2>
              {modal === "deal" ? "Add a new deal" : "Record a transaction"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => setModal(null)}
          >
            <X />
          </button>
        </div>
        {modal === "deal" ? (
          <DealForm save={(d) => save("deal", d)} />
        ) : modal === "entry" ? (
          <EntryForm
            data={data}
            initialDeal={selected ?? undefined}
            save={(e) => save("entry", e)}
          />
        ) : null}
      </dialog>
    </div>
  );
}
function Stat({
  label,
  value,
  caption,
  accent,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  caption: string;
  accent?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="stat-label">
        {label}
        {icon}
      </span>
      <strong>{value}</strong>
      <small>{caption}</small>
      {onClick && <span className="stat-action">View breakdown →</span>}
    </>
  );
  const className =
    "stat " + (accent ? "accent " : "") + (onClick ? "stat-button" : "");
  return onClick ? (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label={`View breakdown: ${label}, ${value}`}
    >
      {content}
    </button>
  ) : (
    <section className={className}>{content}</section>
  );
}
