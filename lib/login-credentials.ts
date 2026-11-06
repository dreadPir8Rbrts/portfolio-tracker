import { z } from "zod";
export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(1024),
});
// Server configuration only. Never expose the directory through an API or NEXT_PUBLIC env.
export function loginEmail(
  username: string,
  configuration: string | undefined,
): string | null {
  const parsed = z
    .record(z.string(), z.string().email())
    .safeParse(JSON.parse(configuration || "{}"));
  if (!parsed.success) throw new Error("Invalid login configuration");
  const key = username.trim().toLowerCase();
  const directory = new Map(
    Object.entries(parsed.data).map(([name, email]) => [
      name.toLowerCase(),
      email,
    ]),
  );
  return directory.get(key) ?? null;
}
