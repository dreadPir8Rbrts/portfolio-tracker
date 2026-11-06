import { readData, failure, checkOrigin } from "@/lib/server-data";
import { prepareDealCreation } from "@/lib/deal-creation";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, data } = await readData();
    if (!data.admin) throw new Error("Admin access required");
    const { deal, entries } = prepareDealCreation(
      await request.json(),
      data.deals,
      data.events,
    );
    const { error } = await db.rpc("create_deal_with_expenses", {
      deal_data: deal,
      expense_rows: entries,
      expected_count: data.events.length,
    });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
