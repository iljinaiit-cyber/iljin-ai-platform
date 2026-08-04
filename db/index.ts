import { drizzle } from "drizzle-orm/d1";
import { getRuntimeEnv } from "../lib/runtime-env";
import * as schema from "./schema";

export function getDb() {
  const binding = getRuntimeEnv().DB;
  if (!binding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(binding, { schema });
}

export function getD1() {
  const binding = getRuntimeEnv().DB;
  if (!binding) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return binding;
}

export function getR2() {
  const binding = getRuntimeEnv().BUCKET;
  if (!binding) throw new Error("Cloudflare R2 binding `BUCKET` is unavailable.");
  return binding;
}
