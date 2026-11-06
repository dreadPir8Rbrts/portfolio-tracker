import { z } from "zod";
import { createHash } from "node:crypto";
import { readData, checkOrigin, failure } from "@/lib/server-data";
import { ids } from "@/lib/model";
import { previewImport } from "@/lib/importer";
import { prepareEntry } from "@/lib/ledger";
const schema = z.object({
  filename: z.string().min(1).max(200),
  text: z.string().max(2000000),
  collector: z.enum(ids),
  commit: z.boolean(),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, data } = await readData();
    if (!data.admin) throw new Error("Admin access required");
    const input = schema.parse(await request.json());
    const preview = previewImport(input.text, data, input.collector);
    const hash = createHash("sha256")
      .update(JSON.stringify(preview.rows))
      .digest("hex");
    const existing = await db
      .from("import_batches")
      .select("id")
      .eq("content_hash", hash);
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data.length)
      throw new Error("This CSV has already been imported");
    if (!input.commit) return Response.json(preview);
    const history = [...data.events];
    const entries = preview.events.map((e) => {
      const prepared = prepareEntry(
        e,
        [...data.deals, ...preview.deals],
        history,
      );
      history.push(e);
      return prepared;
    });
    const { error } = await db.rpc("import_portfolio", {
      batch: {
        filename: input.filename,
        hash,
        rows: preview.rows,
        notes: "Reviewed CSV import",
      },
      deal_rows: preview.deals,
      entry_rows: entries,
      expected_count: data.events.length,
    });
    if (error) throw new Error(error.message);
    return Response.json({
      ok: true,
      deals: preview.deals.length,
      events: entries.length,
    });
  } catch (e) {
    return failure(e);
  }
}
