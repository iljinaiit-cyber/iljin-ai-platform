import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const serverDirectory = resolve(root, "dist", "server");
const clientDirectory = resolve(root, "dist", "client");
const pagesDirectory = resolve(root, "dist", "pages");
const workerDirectory = resolve(pagesDirectory, "_worker.js");
const redirectedWranglerConfig = resolve(root, ".wrangler", "deploy", "config.json");

async function requireDirectory(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found at ${path}. Run the Vinext build first.`);
  }
}

await Promise.all([
  requireDirectory(serverDirectory, "Vinext server output"),
  requireDirectory(clientDirectory, "Vinext client output"),
]);

await rm(pagesDirectory, { recursive: true, force: true });
await mkdir(workerDirectory, { recursive: true });

// Pages serves the client files directly while Advanced Mode executes this
// directory as a module Worker for SSR and API routes.
await cp(clientDirectory, pagesDirectory, { recursive: true, force: true });
await cp(serverDirectory, workerDirectory, { recursive: true, force: true });

const workerIndex = resolve(workerDirectory, "index.js");
const workerEntry = resolve(workerDirectory, "worker-entry.js");
const ssrIndex = resolve(workerDirectory, "ssr", "index.js");
const ssrSource = await readFile(ssrIndex, "utf8");

await cp(workerIndex, workerEntry, { force: true });
await writeFile(workerIndex, 'export { default } from "./worker-entry.js";\n', "utf8");
await writeFile(
  ssrIndex,
  ssrSource.replace('import("../index.js")', 'import("../worker-entry.js")'),
  "utf8",
);

// This file configures `vinext start`/Workers development. Leaving it inside
// `_worker.js` makes Wrangler treat it as the Pages project configuration.
await rm(resolve(workerDirectory, "wrangler.json"), { force: true });
await rm(redirectedWranglerConfig, { force: true });

await writeFile(
  resolve(pagesDirectory, "_routes.json"),
  `${JSON.stringify(
    {
      version: 1,
      include: ["/*"],
      exclude: [
        "/assets/*",
        "/*.png",
        "/*.svg",
        "/*.ico",
        "/*.webp",
        "/*.jpg",
        "/*.jpeg",
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Cloudflare Pages bundle prepared at ${pagesDirectory}`);
