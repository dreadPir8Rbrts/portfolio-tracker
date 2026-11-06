import { handleLogin } from "./handler.ts";
Deno.serve((request: Request) =>
  handleLogin(request, {
    url: Deno.env.get("SUPABASE_URL")!,
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  }),
);
