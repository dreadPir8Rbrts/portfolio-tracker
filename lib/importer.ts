import {
  Data,
  Deal,
  Entry,
  PersonId,
  dealSchema,
  eventSchema,
  parseMoney,
  ids,
} from "./model";
import { prepareEntry } from "./ledger";
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else throw new Error("Unexpected quote in CSV");
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  const header =
    rows.shift()?.map((v) => v.replace(/^\uFEFF/, "").trim()) ?? [];
  if (!header.length || new Set(header).size !== header.length)
    throw new Error("Missing or duplicate CSV headers");
  if (rows.length > 1000)
    throw new Error("Import at most 1,000 rows at a time");
  return rows.map((r, i) => {
    if (r.length !== header.length)
      throw new Error(`CSV row ${i + 2}: incorrect number of columns`);
    return Object.fromEntries(header.map((h, j) => [h, r[j].trim()]));
  });
}
const amount = (s: string) => parseMoney(s.replace(/[$,]/g, "").trim());
function date(s: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) throw new Error("Use YYYY-MM-DD or M-D-YYYY dates");
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
function person(s: string): PersonId {
  const key = s.toLowerCase().trim();
  const p = (
    {
      joey: "joey",
      dread: "joey",
      "1of1": "1of1",
      max: "max",
      matthew: "matthew",
      "pokemon hooper": "hooper",
      hooper: "hooper",
    } as Record<string, PersonId>
  )[key];
  if (!p) throw new Error(`Unknown person: ${s}`);
  return p;
}
export type ImportPreview = {
  deals: Deal[];
  events: Entry[];
  warnings: string[];
  rows: Record<string, string>[];
};
export function previewImport(
  text: string,
  data: Data,
  collector: PersonId,
): ImportPreview {
  const rows = parseCsv(text),
    deals: Deal[] = [],
    events: Entry[] = [],
    warnings: string[] = [];
  const names = {
    joey: "Joey",
    "1of1": "1of1",
    max: "Max",
    matthew: "Matthew",
    hooper: "Pokemon Hooper",
  };
  for (const [i, r] of rows.entries()) {
    try {
      if ("Card Name" in r) {
        const members = ids
          .map((p) => ({
            person: p,
            weight: Number(
              r[
                p === "joey"
                  ? "Joey Ownership %"
                  : p === "max"
                    ? "Max Ownership %"
                    : names[p] + " %"
              ] || 0,
            ),
            funded: amount(r[names[p] + " Initial Payment"] || "0"),
          }))
          .filter((m) => m.weight > 0);
        if (!members.length) throw new Error("Ownership is required");
        const sum = members.reduce((n, m) => n + m.weight, 0);
        if (sum !== 100) {
          if (!members.every((m) => m.weight === members[0].weight))
            throw new Error("Unequal ownership percentages must total 100");
          warnings.push(
            `Row ${i + 2}: ${sum}% interpreted as equal ownership shares.`,
          );
        }
        // Convert percentages into integer units, preserving decimal ownership precision.
        members.forEach((m) => (m.weight = Math.round(m.weight * 10000)));
        const d = dealSchema.parse({
          id: crypto.randomUUID(),
          name: r["Card Name"],
          source: r.Source || "",
          variant: r.Variant || "",
          grade: r.Grade || "",
          acquired: date(r["Date Acquired"]),
          cost: amount(r["Purchase Price"]),
          notes: "Imported historical deal",
          items: r["Card Name"],
          members,
        });
        if (
          [...data.deals, ...deals].some(
            (x) =>
              x.name === d.name &&
              x.acquired === d.acquired &&
              x.cost === d.cost,
          )
        )
          throw new Error(
            "Possible duplicate deal: same name, date and purchase price",
          );
        Object.assign(d, { _importRow: i + 1 });
        deals.push(d);
        if (r["Date Sold"] || r["Sale Price"]) {
          if (!members.some((m) => m.person === collector))
            throw new Error(
              "Selected sale collector must participate in the deal",
            );
          events.push(
            eventSchema.parse({
              id: crypto.randomUUID(),
              dealId: d.id,
              kind: "sale",
              date: date(r["Date Sold"]),
              amount: amount(r["Sale Price"]),
              fees: 0,
              from: collector,
              to: null,
              notes: "Imported full sale; fees not provided in source",
              close: true,
              target: null,
            }),
          );
          warnings.push(
            `Row ${i + 2}: sale treated as final, collected by ${names[collector]}, with no fees. Confirm before importing.`,
          );
        }
      } else {
        const original = "Unrelated payment amount" in r;
        const type = original ? "on_behalf" : r.Type;
        if (
          ![
            "payment",
            "on_behalf",
            "adjustment",
            "purchase_funding",
            "sale_receipt",
          ].includes(type)
        )
          throw new Error(
            "Type must be payment, on_behalf, adjustment, purchase_funding, or sale_receipt",
          );
        const linked = ["purchase_funding", "sale_receipt"].includes(type);
        const deal = linked
          ? data.deals.find((d) => d.id === r.deal_id)
          : undefined;
        if (linked && !deal)
          throw new Error("A valid existing deal_id is required");
        if (type === "sale_receipt" && !r.Received_by)
          throw new Error("Received_by is required for sale receipts");
        if (r.Final && !["true", "false"].includes(r.Final))
          throw new Error("Final must be true or false");
        if (
          type !== "sale_receipt" &&
          (r.Received_by ||
            (r.Fees && amount(r.Fees) !== 0) ||
            r.Final === "true")
        )
          throw new Error(
            "Received_by, Fees and Final apply only to sale receipts",
          );
        const kind = type === "sale_receipt" ? "sale" : type;
        const e = eventSchema.parse({
          id: crypto.randomUUID(),
          dealId: deal?.id ?? null,
          kind,
          date: date(original ? r.date : r.Date || r.date),
          amount: amount(original ? r["Unrelated payment amount"] : r.Amount),
          fees: type === "sale_receipt" ? amount(r.Fees || "0") : 0,
          from: person(
            type === "sale_receipt"
              ? r.Received_by
              : original
                ? r["Paid by"]
                : r.From || r.Payer,
          ),
          to: linked
            ? null
            : person(original ? r["Paid for"] : r.To || r.on_behalf_of),
          notes:
            type === "sale_receipt" && r.Payer
              ? [r.Notes, "Buyer: " + r.Payer].filter(Boolean).join("\n")
              : r.Notes,
          reference: r.Reference || "",
          close: type === "sale_receipt" && r.Final === "true",
          target: null,
        });
        if (
          [...data.events, ...events].some(
            (x) =>
              x.kind === e.kind &&
              x.dealId === e.dealId &&
              x.date === e.date &&
              x.amount === e.amount &&
              x.from === e.from &&
              x.to === e.to &&
              x.notes === e.notes,
          )
        )
          throw new Error("Possible duplicate payment");
        events.push(e);
      }
    } catch (e) {
      throw new Error(
        `Row ${i + 2}: ${e instanceof Error ? e.message : "Invalid data"}`,
      );
    }
  }
  if (!rows.length) throw new Error("CSV has no data rows");
  // Validate the complete chronological preview, including existing sales,
  // so a second final receipt or duplicate purchase funding cannot be committed.
  events.sort((a, b) => a.date.localeCompare(b.date));
  const history = [...data.events];
  for (const e of events) {
    prepareEntry(e, [...data.deals, ...deals], history);
    history.push(e);
  }
  events.forEach((e) => {
    if (!(e as Entry & { _importRow?: number })._importRow) {
      const d = deals.find((d) => d.id === e.dealId) as
        (Deal & { _importRow?: number }) | undefined;
      Object.assign(e, { _importRow: d?._importRow ?? events.indexOf(e) + 1 });
    }
  });
  return {
    deals,
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
    warnings,
    rows,
  };
}
