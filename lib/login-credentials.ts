import { z } from "zod";
export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((v) => v.toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)),
  password: z.string().min(1).max(1024),
});
