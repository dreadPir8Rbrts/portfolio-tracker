import { supabase } from "./supabase";
import { Data, Deal, Entry } from "./model";
export async function readData() {
  const db = await supabase();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user) throw new Error("Sign in to continue");
  const identity = await db.rpc("my_identity");
  if (identity.error)
    throw new Error(
      "Database setup is incomplete. Apply the migration and link your account.",
    );
  if (!identity.data?.person)
    throw new Error(
      "Your login has not been linked to a partner. Contact Joey.",
    );
  // Paginate explicitly: Supabase limits each response to 1,000 rows by default.
  async function all(table: string, order: string, structured = false) {
    const rows = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await db
        .from(table)
        .select(structured ? "*" : "payload")
        .order(order)
        .order("id")
        .range(start, start + 499);
      if (error) throw new Error(error.message);
      rows.push(...data.map((r) => (structured ? r : r.payload)));
      if (data.length < 500) return rows;
    }
  }
  const [deals, events, inventory, checkpoints] = await Promise.all([
    all("deals", "created_at"),
    all("entries", "seq"),
    all("inventory_items", "created_at", true),
    all("reconciliation_checkpoints", "created_at", true),
  ]);
  return {
    db,
    data: {
      ...identity.data,
      inventory,
      checkpoints,
      deals: deals as Deal[],
      events: events as Entry[],
    } as Data,
  };
}
export function failure(e: unknown) {
  return Response.json(
    { error: e instanceof Error ? e.message : "Request failed" },
    { status: 400 },
  );
}
export { checkOrigin } from "./request-origin";
