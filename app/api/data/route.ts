import { readData, failure } from "@/lib/server-data";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json((await readData()).data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
