import { readData, checkOrigin, failure } from "@/lib/server-data";
import { checkpointSchema } from "@/lib/model";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, data } = await readData();
    if (!data.admin) throw new Error("Admin access required");
    const checkpoint = checkpointSchema.parse(await request.json());
    const { error } = await db
      .from("reconciliation_checkpoints")
      .insert(checkpoint);
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
