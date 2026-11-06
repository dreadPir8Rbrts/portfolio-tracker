import Portal from "@/components/portal";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/login");
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return <Portal demo={false} />;
}
