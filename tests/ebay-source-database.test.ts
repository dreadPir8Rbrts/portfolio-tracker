import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eventSchema } from "../lib/model";
import { prepareEntry } from "../lib/ledger";

test("database enforces source metadata and forwarding links while preserving partner RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
    const users = {
      dread: crypto.randomUUID(),
      "1of1": crypto.randomUUID(),
      chang: crypto.randomUUID(),
    };
    for (const [person, id] of Object.entries(users)) {
      await db.query("insert into auth.users(id) values($1)", [id]);
      await db.query(
        "update public.people set auth_user_id=$1,admin=$3 where id=$2",
        [id, person, person === "dread"],
      );
    }
    async function as(person: keyof typeof users) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        users[person],
      ]);
      await db.exec("set role authenticated");
    }
    await as("dread");
    const incoming = eventSchema.parse({
      id: crypto.randomUUID(),
      kind: "payment",
      dealId: null,
      from: "1of1",
      to: "dread",
      date: "2026-01-01",
      amount: 1000,
      notes: "Example",
      source: "ebay",
      sourceCategory: "pass_through",
    });
    await db.query("select public.append_entry($1,0)", [
      JSON.stringify(prepareEntry(incoming, [], [])),
    ]);
    const out = eventSchema.parse({
      ...incoming,
      id: crypto.randomUUID(),
      kind: "on_behalf",
      from: "dread",
      to: "1of1",
      sourceCategory: "forwarded",
      payoutEntryId: incoming.id,
    });
    await assert.rejects(
      db.query("select public.append_entry($1,1)", [
        JSON.stringify({ ...prepareEntry(out, [], [incoming]), amount: 1001 }),
      ]),
      /exceed/,
    );
    await assert.rejects(
      db.query("select public.append_entry($1,1)", [
        JSON.stringify({
          ...prepareEntry(out, [], [incoming]),
          payoutEntryId: crypto.randomUUID(),
        }),
      ]),
      /incoming/,
    );
    await assert.rejects(
      db.query("select public.append_entry($1,1)", [
        JSON.stringify({
          ...prepareEntry(out, [], [incoming]),
          source: "other",
        }),
      ]),
      /entries_source_classification/,
    );
    await db.query("select public.append_entry($1,1)", [
      JSON.stringify(prepareEntry(out, [], [incoming])),
    ]);
    await as("1of1");
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      2,
    );
    await assert.rejects(
      db.query(
        'update public.entries set payload=payload || \'{"source":"other"}\'::jsonb',
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.append_entry($1,2)", [JSON.stringify(incoming)]),
      /Admin access required/,
    );
    await as("chang");
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select * from public.entries"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
