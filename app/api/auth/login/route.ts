import { supabase } from "@/lib/supabase";
import { checkOrigin } from "@/lib/server-data";
import { loginEmail, loginSchema } from "@/lib/login-credentials";
const denied = () =>
  Response.json(
    { error: "Incorrect username or password." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
export async function POST(request: Request) {
  try {
    checkOrigin(request);
  } catch {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const credentials = loginSchema.safeParse(await request.json());
    if (!credentials.success) return denied();
    const { username, password } = credentials.data;
    const email = loginEmail(username, process.env.AUTH_USERNAME_EMAILS);
    // Unknown usernames follow the same authentication path and generic response.
    const db = await supabase();
    const { error } = await db.auth.signInWithPassword({
      email: email ?? "unknown-login@example.invalid",
      password,
    });
    if (error || !email) {
      if (!error) await db.auth.signOut({ scope: "local" });
      if (error?.status === 429)
        return Response.json(
          { error: "Too many attempts. Please wait and try again." },
          { status: 429, headers: { "Cache-Control": "no-store" } },
        );
      return denied();
    }
    const identity = await db.rpc("my_identity");
    if (identity.error || !identity.data?.person) {
      await db.auth.signOut({ scope: "local" });
      return denied();
    }
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Unable to sign in right now. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
