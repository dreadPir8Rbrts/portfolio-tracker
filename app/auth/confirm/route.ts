import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.APP_ORIGIN || url.origin;
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (token_hash && ["invite", "magiclink", "email"].includes(type ?? "")) {
    const db = await supabase();
    const { error } = await db.auth.verifyOtp({
      token_hash,
      type: type as "invite" | "magiclink" | "email",
    });
    if (!error) return NextResponse.redirect(new URL("/", origin));
  }
  return NextResponse.redirect(new URL("/login?error=expired", origin));
}
