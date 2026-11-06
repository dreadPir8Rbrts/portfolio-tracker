import { readData, failure, checkOrigin } from "@/lib/server-data";
import { eventSchema } from "@/lib/model";
import { validateEntry, prepareEntry } from "@/lib/ledger";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, data } = await readData();
    if (!data.admin) throw new Error("Admin access required");
    const e = eventSchema.parse(await request.json());
    if (["ownership_correction", "credit_sale"].includes(e.kind))
      throw new Error(
        "Ownership corrections and internal transfers require an atomic reviewed update",
      );
    validateEntry(e, data.deals, data.events);
    if (e.kind === "void") {
      const target = data.events.find((x) => x.id === e.target)!;
      e.from = target.from;
      e.to = target.to;
    }
    const { error } = await db.rpc("append_entry", {
      data: prepareEntry(e, data.deals, data.events, data.inventory),
      expected_count: data.events.length,
    });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
