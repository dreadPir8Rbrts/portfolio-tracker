import { test } from "node:test";
import assert from "node:assert/strict";
import { loginSchema } from "../lib/login-credentials";
import { handleLogin } from "../supabase/functions/username-login/handler";
const config = {
  url: "https://example.invalid",
  serviceKey: "server-only-test",
  anonKey: "public-test",
};
const request = (username = "dread", password = " Secret ") =>
  new Request("https://example.invalid", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
test("usernames normalize, passwords retain whitespace; email login is rejected", () => {
  assert.deepEqual(
    loginSchema.parse({ username: " DrEaD ", password: " Secret " }),
    { username: "dread", password: " Secret " },
  );
  for (const username of ["", "a@example.com", "__proto__"])
    assert.equal(
      loginSchema.safeParse({ username, password: "secret" }).success,
      false,
    );
});
test("login keeps email/service key internal and returns only verified session tokens", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const responses = [
    { email: "private@example.com", limited: false },
    {
      access_token: "access",
      refresh_token: "refresh",
      user: { email: "private@example.com" },
    },
    { person: "dread", admin: true },
  ];
  const fake = (async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(responses.shift());
  }) as typeof fetch;
  const result = await handleLogin(request(" DREAD "), config, fake);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    access_token: "access",
    refresh_token: "refresh",
  });
  assert.deepEqual(JSON.parse(calls[0].init!.body as string), {
    username: "dread",
  });
  assert.deepEqual(JSON.parse(calls[1].init!.body as string), {
    email: "private@example.com",
    password: " Secret ",
  });
  assert.equal(
    (calls[1].init!.headers as Record<string, string>).apikey,
    "public-test",
  );
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("unknown usernames follow password verification and generic errors", async () => {
  let calls = 0;
  const fake = (async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json({ email: null, limited: false });
    assert.equal(
      JSON.parse(init!.body as string).email,
      "unknown-login@example.invalid",
    );
    return Response.json({}, { status: 400 });
  }) as typeof fetch;
  const result = await handleLogin(request("unknown"), config, fake);
  assert.equal(calls, 2);
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), {
    error: "Incorrect username or password.",
  });
});
test("throttled logins stop before password verification", async () => {
  let calls = 0;
  const result = await handleLogin(request(), config, (async () => {
    calls++;
    return Response.json({ limited: true });
  }) as typeof fetch);
  assert.equal(result.status, 429);
  assert.equal(calls, 1);
});
test("changed account links fail closed; lookup failures do not leak details", async () => {
  const responses = [
    { email: "private@example.com" },
    { access_token: "access", refresh_token: "refresh" },
    { person: "max" },
  ];
  assert.equal(
    (
      await handleLogin(request(), config, (async () =>
        Response.json(responses.shift())) as typeof fetch)
    ).status,
    401,
  );
  assert.equal(
    (
      await handleLogin(request(), config, (async () =>
        Response.json({ secret: "hidden" }, { status: 500 })) as typeof fetch)
    ).status,
    503,
  );
});
