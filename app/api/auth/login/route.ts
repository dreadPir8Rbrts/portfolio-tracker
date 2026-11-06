import { supabase } from "@/lib/supabase";
import { checkOrigin } from "@/lib/server-data";
import { loginSchema } from "@/lib/login-credentials";
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
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/username-login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        },
        body: JSON.stringify({ username, password }),
        cache: "no-store",
      },
    );
    if (response.status === 429)
      return Response.json(
        { error: "Too many attempts. Please wait and try again." },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": "60" },
        },
      );
    if (response.status >= 500) throw new Error("Authentication unavailable");
    if (!response.ok) return denied();
    const session = await response.json();
    const db = await supabase();
    const { error } = await db.auth.setSession(session);
    if (error) return denied();
    const identity = await db.rpc("my_identity");
    if (identity.error || identity.data?.person !== username) {
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
