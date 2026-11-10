import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { gradingFixture } from "./grading-fixtures";
import { prepareGrading } from "../lib/grading";
import { prepareEntry } from "../lib/ledger";

test("grading schema enforces atomic expenses, concurrency, audit, links and participant RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    for (const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
    const users = {
      dread: crypto.randomUUID(),
      "1of1": crypto.randomUUID(),
      chang: crypto.randomUUID(),
    };
    for (const [p, id] of Object.entries(users)) {
      await db.query("insert into auth.users(id) values($1)", [id]);
      await db.query(
        "update public.people set auth_user_id=$1,admin=$3 where id=$2",
        [id, p, p === "dread"],
      );
    }
    async function as(p: keyof typeof users) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        users[p],
      ]);
      await db.exec("set role authenticated");
    }
    const { deal, submission, expense, paid, data } = gradingFixture();
    await as("dread");
    await db.query("insert into public.deals(id,payload) values($1,$2)", [
      deal.id,
      JSON.stringify(deal),
    ]);
    async function save(s: unknown, e: unknown, v: number, count: number) {
      return db.query<any>("select * from public.save_grading($1,$2,$3,$4)", [
        JSON.stringify(s),
        e ? JSON.stringify(e) : null,
        v,
        count,
      ]);
    }
    await save(submission, null, 0, 0);
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      0,
    );
    const p = prepareGrading(
      { submission: paid, expense, expected_version: 1 },
      { ...data, grading: [{ ...submission, version: 1 }] },
    );
    await save(p.submission, p.expense, 1, 0);
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      1,
    );
    // Retry/stale submission must not append another expense.
    await assert.rejects(
      save(p.submission, p.expense, 1, 1),
      /Submission changed/,
    );
    await assert.rejects(
      save({ ...paid, final_grading_costs: 2000 }, null, 2, 1),
      /Reverse|Payment must match/,
    );
    await assert.rejects(
      save({ ...paid, id: crypto.randomUUID() }, null, 0, 1),
      /unique/,
    );
    await assert.rejects(
      save(
        {
          ...submission,
          id: crypto.randomUUID(),
          inventory_item_id: crypto.randomUUID(),
        },
        null,
        0,
        1,
      ),
      /Inventory card/,
    );
    // A failing submission must roll back its newly inserted financial entry.
    const badExpense = prepareEntry(
      { ...expense, id: crypto.randomUUID() },
      data.deals,
      [p.expense!],
    );
    await assert.rejects(
      save(
        {
          ...paid,
          id: crypto.randomUUID(),
          expense_entry_id: badExpense.id,
          final_grading_costs: 2000,
        },
        badExpense,
        0,
        1,
      ),
      /Payment must match/,
    );
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      1,
    );
    await save(
      {
        ...paid,
        status: "completed",
        date_completed: "2026-01-04",
        final_grade: "10",
      },
      null,
      2,
      1,
    );
    assert.equal(
      (await db.query("select * from public.grading_history")).rows.length,
      3,
    );
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      1,
    );
    await as("1of1");
    assert.equal(
      (await db.query("select * from public.grading")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.grading_history")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.grading set notes='blocked',version=version+1 returning id",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(save(submission, null, 0, 1), /Admin/);
    await as("chang");
    assert.equal(
      (await db.query("select * from public.grading")).rows.length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select * from public.grading"),
      /permission denied/,
    );
    await as("dread");
    const standalone = prepareEntry(
      { ...expense, id: crypto.randomUUID(), amount: 2000 },
      data.deals,
      [p.expense!],
    );
    await db.query("select public.append_entry($1,1)", [
      JSON.stringify(standalone),
    ]);
    const linked = {
      ...paid,
      id: crypto.randomUUID(),
      expense_entry_id: standalone.id,
      final_grading_costs: 2000,
    };
    await assert.rejects(save(linked, null, 0, 1), /Ledger changed/);
    await save(linked, null, 0, 2);
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from public.grading")).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
