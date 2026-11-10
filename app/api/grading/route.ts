import { readData, failure, checkOrigin } from "@/lib/server-data";
import { prepareGrading } from "@/lib/grading";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, data } = await readData();
    const prepared = prepareGrading(await request.json(), data);
    const { error } = await db.rpc("save_grading", {
      submission: prepared.submission,
      expense_data: prepared.expense ?? null,
      expected_version: prepared.expected_version,
      expected_count: data.events.length,
    });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
