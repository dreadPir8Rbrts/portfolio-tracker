import { test, expect } from "@playwright/test";
test("password form submits credentials without requesting an email link", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.route("**/api/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      username: "dread",
      password: "test-password-only",
    });
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Incorrect username or password." }),
    });
  });
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Send sign-in link" }),
  ).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill("dread");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in →", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Incorrect username or password.",
  );
  expect(requests.some((url) => url.includes("/auth/v1/otp"))).toBe(false);
});
test("successful password login opens the dashboard", async ({ page }) => {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    }),
  );
  await page.route("http://127.0.0.1:3000/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Authenticated dashboard</h1>",
    }),
  );
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill("joey");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in →", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Authenticated dashboard" }),
  ).toBeVisible();
});
test("login endpoint rejects cross-origin credential submissions", async ({
  request,
}) => {
  const res = await request.post("/api/auth/login", {
    headers: { Origin: "https://unrelated.example" },
    data: { username: "dread", password: "test-password-only" },
  });
  expect(res.status()).toBe(403);
});
