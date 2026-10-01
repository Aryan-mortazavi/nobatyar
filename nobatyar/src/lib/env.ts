/**
 * Environment contract.
 *
 * Parsed once with Zod: a missing or malformed variable fails loudly at boot
 * instead of surfacing as a 500 in production. `server-only` guarantees none of
 * this can leak into the browser bundle.
 */
import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(["fa", "en"]).default("fa"),
});

const parsed = schema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`,
  );
}

export const env = parsed.data;
export const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
export const defaultLocale = env.NEXT_PUBLIC_DEFAULT_LOCALE;
export const isProd = process.env.NODE_ENV === "production";
