import { test } from "node:test";
import assert from "node:assert/strict";
import { loginEmail, loginSchema } from "../lib/login-credentials";
test("usernames normalize; passwords retain case and whitespace", () => {
  const c = loginSchema.parse({
    username: "  DrEaD  ",
    password: " Password With Spaces ",
  });
  assert.equal(c.username, "dread");
  assert.equal(c.password, " Password With Spaces ");
  assert.equal(
    loginEmail(
      c.username,
      '{"joey":"test@example.com","dread":"test@example.com"}',
    ),
    "test@example.com",
  );
});
test("unregistered usernames and inherited properties never resolve", () => {
  for (const username of ["missing", "toString", "constructor", "__proto__"])
    assert.equal(loginEmail(username, '{"joey":"test@example.com"}'), null);
  assert.equal(loginEmail("joey", undefined), null);
});
test("invalid credentials and malformed server configuration fail closed", () => {
  assert.equal(
    loginSchema.safeParse({ username: " ", password: "x" }).success,
    false,
  );
  assert.equal(
    loginSchema.safeParse({ username: "joey", password: "" }).success,
    false,
  );
  assert.throws(() => loginEmail("joey", '{"joey":true}'));
  assert.throws(() => loginEmail("joey", "invalid json"));
});
