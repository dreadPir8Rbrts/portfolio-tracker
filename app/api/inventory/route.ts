import { z } from "zod";
import { readData, checkOrigin, failure } from "@/lib/server-data";
import { inventorySchema } from "@/lib/model";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, data } = await readData();
    if (!data.admin) throw new Error("Admin access required");
    const { parent, children } = z
      .object({
        parent: z.string().uuid(),
        children: z.array(inventorySchema).min(1).max(1000),
      })
      .parse(await request.json());
    const { error } = await db.rpc("split_inventory", { parent, children });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
