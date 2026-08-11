const projectName = "iljin-ai";
const healthUrl = `https://${projectName}.pages.dev/api/health`;
const attempts = 6;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastError;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(healthUrl, { headers: { accept: "application/json" } });
    const health = await response.json();
    if (!response.ok) throw new Error(`health endpoint returned ${response.status}`);
    if (!health.bindings?.db) throw new Error("D1 binding DB is unavailable in the Pages deployment");
    console.log(`Pages health check passed: ${healthUrl} (${health.status})`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < attempts) await wait(2_000);
  }
}

throw new Error(`Pages health check failed for ${healthUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
