import { drizzle } from "drizzle-orm/d1";
import { getRuntimeEnv } from "../lib/runtime-env";
import * as schema from "./schema";

export class RuntimeBindingError extends Error {
  constructor(readonly binding: "DB" | "BUCKET") {
    super(`Required runtime binding ${binding} is unavailable.`);
    this.name = "RuntimeBindingError";
  }
}

export function getDb() {
  const binding = getRuntimeEnv().DB;
  if (!binding) {
    throw new RuntimeBindingError("DB");
  }

  return drizzle(binding, { schema });
}

export function getD1() {
  const binding = getRuntimeEnv().DB;
  if (!binding) throw new RuntimeBindingError("DB");
  return binding;
}

export function getR2() {
  const binding = getRuntimeEnv().BUCKET;
  if (!binding) throw new RuntimeBindingError("BUCKET");
  return binding;
}
