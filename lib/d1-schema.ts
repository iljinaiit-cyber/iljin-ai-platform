import { getD1 } from "../db";

type SchemaRequirements = Record<string, readonly string[]>;

/**
 * Verifies the D1 schema installed by migrations without changing it.
 * Runtime code must never create or alter production schema objects.
 */
export async function verifyD1Schema(requirements: SchemaRequirements) {
  const entries = Object.entries(requirements);
  const checks = await getD1().batch(entries.map(([table]) => getD1().prepare(`PRAGMA table_info(${table})`)));
  const missing = checks.flatMap((check, index) => {
    const [table, columns] = entries[index];
    const available = new Set(((check.results || []) as Array<{ name: string }>).map((column) => column.name));
    return available.size === 0 || columns.some((column) => !available.has(column)) ? [table] : [];
  });
  if (missing.length) {
    throw new Error(`D1_SCHEMA_OUTDATED: apply the reviewed D1 migrations for ${missing.join(", ")}`);
  }
}
