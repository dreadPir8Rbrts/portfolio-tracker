import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOrigin } from "../lib/request-origin";
const dev = { development: true, appOrigin: undefined };
const req = (
  origin: string,
  host = "localhost:3000",
  url = "http://127.0.0.1:3000/api/auth/login",
) => new Request(url, { headers: { origin, host } });
test("local browser hostname can differ from Next bind address", () => {
  assert.doesNotThrow(() => checkOrigin(req("http://localhost:3000"), dev));
  assert.doesNotThrow(() =>
    checkOrigin(req("http://127.0.0.1:3000", "127.0.0.1:3000"), dev),
  );
  assert.doesNotThrow(() =>
    checkOrigin(
      req(
        "http://127.0.0.1:3000",
        "127.0.0.1:3000",
        "http://localhost:3000/api/auth/login",
      ),
      dev,
    ),
  );
});
test("local exception rejects different ports, external sites, and forged host combinations", () => {
  for (const origin of [
    "https://unrelated.example",
    "http://localhost:4000",
    "http://localhost.evil.test:3000",
    "null",
    "http://localhost:3000/path",
  ])
    assert.throws(() => checkOrigin(req(origin), dev));
  assert.throws(() =>
    checkOrigin(req("http://localhost:3000", "unrelated.example"), dev),
  );
  assert.throws(() =>
    checkOrigin(new Request("http://127.0.0.1:3000/api/auth/login"), dev),
  );
});
test("production and configured origins remain strict", () => {
  assert.throws(() =>
    checkOrigin(req("http://localhost:3000"), {
      development: false,
      appOrigin: undefined,
    }),
  );
  const config = { development: false, appOrigin: "https://ledger.example/" };
  assert.doesNotThrow(() => checkOrigin(req("https://ledger.example"), config));
  assert.throws(() => checkOrigin(req("http://localhost:3000"), config));
  assert.throws(() =>
    checkOrigin(req("http://localhost:3000"), {
      development: true,
      appOrigin: "https://ledger.example",
    }),
  );
});
