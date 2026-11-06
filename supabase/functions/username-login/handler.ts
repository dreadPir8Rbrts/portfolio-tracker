// This public endpoint authenticates passwords itself; the privileged lookup is never returned.
export async function handleLogin(
  request: Request,
  config: {
    url: string;
    serviceKey: string;
    anonKey: string;
  },
  send: typeof fetch = fetch,
): Promise<Response> {
  const reply = (status: number, body: unknown) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 429 ? { "Retry-After": "60" } : {}),
      },
    });
  const denied = () => reply(401, { error: "Incorrect username or password." });
  if (request.method !== "POST")
    return reply(405, { error: "Method not allowed." });
  try {
    if (Number(request.headers.get("content-length") || 0) > 8192)
      return denied();
    const raw = await request.text();
    if (raw.length > 8192) return denied();
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return denied();
    }
    if (
      !input ||
      typeof input.username !== "string" ||
      typeof input.password !== "string"
    )
      return denied();
    const username = input.username.trim().toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(username) ||
      !input.password.length ||
      input.password.length > 1024
    )
      return denied();
    const lookup = await send(`${config.url}/rest/v1/rpc/resolve_login`, {
      method: "POST",
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username }),
    });
    if (!lookup.ok) throw new Error("Lookup unavailable");
    const resolved = await lookup.json();
    if (resolved.limited)
      return reply(429, {
        error: "Too many attempts. Please wait and try again.",
      });
    const auth = await send(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: resolved.email ?? "unknown-login@example.invalid",
        password: input.password,
      }),
    });
    if (auth.status === 429)
      return reply(429, {
        error: "Too many attempts. Please wait and try again.",
      });
    if (auth.status >= 500) throw new Error("Auth unavailable");
    if (!auth.ok || !resolved.email) return denied();
    const session = await auth.json();
    // Validate the account link again using the authenticated caller's identity.
    const identity = await send(`${config.url}/rest/v1/rpc/my_identity`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!identity.ok || (await identity.json()).person !== username)
      return denied();
    return reply(200, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  } catch {
    return reply(503, {
      error: "Unable to sign in right now. Please try again.",
    });
  }
}
