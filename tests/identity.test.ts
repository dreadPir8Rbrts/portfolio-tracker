import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("identity migration preserves payloads and securely links logins to people", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    const files = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files.slice(0, -1))
      await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
    const uid = "30000000-0000-4000-8000-000000000001";
    await db.query<any>("insert into auth.users values($1,$2)", [
      uid,
      "admin@example.com",
    ]);
    await db.query<any>("insert into private.accounts values($1,'joey',true)", [
      uid,
    ]);
    await db.query<any>("select set_config('request.jwt.claim.sub',$1,false)", [
      uid,
    ]);
    await db.exec(readFileSync("supabase/migrations/" + files.at(-1), "utf8"));
    await db.exec("set role authenticated");
    assert.deepEqual(
      (await db.query<any>("select public.my_identity() as i")).rows[0].i,
      { person: "dread", admin: true },
    );
    assert.equal(
      (await db.query<any>("select id,name from public.people")).rows.length,
      5,
    );
    await assert.rejects(
      db.exec("update public.people set admin=true where id='max'"),
    );
    await assert.rejects(db.exec("select auth_user_id from public.people"));
    await assert.rejects(db.exec("select public.resolve_login('dread')"));
    await db.exec("reset role;set role anon");
    await assert.rejects(db.exec("select * from public.people"));
    await assert.rejects(db.exec("select public.resolve_login('dread')"));
    await db.exec("reset role;set role service_role");
    for (let i = 0; i < 10; i++)
      assert.deepEqual(
        (await db.query<any>("select public.resolve_login(' DREAD ') as r"))
          .rows[0].r,
        { email: "admin@example.com", limited: false },
      );
    assert.equal(
      (await db.query<any>("select public.resolve_login('dread') as r")).rows[0]
        .r.limited,
      true,
    );
    assert.deepEqual(
      (await db.query<any>("select public.resolve_login('unknown') as r"))
        .rows[0].r,
      { email: null, limited: false },
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<any>(
          "select count(*)::int as n from public.people where admin",
        )
      ).rows[0].n,
      1,
    );
    await db.query<any>("delete from auth.users where id=$1", [uid]);
    assert.equal(
      (
        await db.query<any>(
          "select auth_user_id from public.people where id='dread'",
        )
      ).rows[0].auth_user_id,
      null,
    );
    await db.exec("set role authenticated");
    assert.deepEqual(
      (await db.query<any>("select public.my_identity() as i")).rows[0].i,
      { person: null, admin: false },
    );
  } finally {
    await db.close();
  }
});
