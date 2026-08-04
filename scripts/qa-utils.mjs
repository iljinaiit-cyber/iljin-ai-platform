import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function argument(name, fallback) {
  const prefix = `--${name}=`;
  const equals = process.argv.find((value) => value.startsWith(prefix));
  const index = process.argv.indexOf(`--${name}`);
  return equals?.slice(prefix.length) || (index >= 0 ? process.argv[index + 1] : undefined) || fallback;
}

export async function writeReport(relativePath, report) {
  const target = path.resolve(projectRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

export function runNode(relativeScript, args = []) {
  return spawnSync(process.execPath, [path.resolve(projectRoot, relativeScript), ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
}

export function summaryStatus(results) {
  return results.every((item) => item.status === "pass") ? "pass" : "fail";
}

export function assertLoopback(baseUrl) {
  const parsed = new URL(baseUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("Live QA with development identity headers is restricted to a loopback URL.");
  }
  return parsed.href.replace(/\/$/, "");
}
