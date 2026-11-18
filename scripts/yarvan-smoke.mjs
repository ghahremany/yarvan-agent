// Exercise the bundled OSS server without an existing workspace, model login or Enterprise adapter.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function freePort(other = 0) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slot = createServer(); slot.listen(0, "127.0.0.1"); await once(slot, "listening");
    const { port } = slot.address(); await new Promise((resolve) => slot.close(resolve));
    if (port !== other) return port;
  }
  throw new Error("Could not reserve a separate webhook port.");
}

assert(!existsSync("enterprise") && !existsSync("dist-server/enterprise"), "The OSS smoke test must not load an Enterprise tree.");
const api = await freePort(), hooks = await freePort(api);
const root = mkdtempSync(join(tmpdir(), "yarvan-bundle-smoke-"));
const home = join(root, "home");
mkdirSync(home);
const child = spawn(process.execPath, ["dist-server/index.js"], {
  stdio: ["ignore", "pipe", "pipe"], env: {
    PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMB_DATA_DIR: join(root, "data"),
    OMB_PORT: String(api), OMB_WEBHOOK_PORT: String(hooks), OMB_BROWSER_CONNECTION: join(root, "browser-connection.json"),
    OMB_DISABLE_ANNOUNCEMENTS: "1", OMB_DISABLE_MODEL_MANIFEST_FETCH: "1", OMB_DISABLE_MODEL_CATALOG_FETCH: "1",
    OMB_LICENSE_KEY: "omb1.not.real",
  },
});
let logs = "";
const tail = (data) => { logs = (logs + data).slice(-8000); };
child.stdout.on("data", tail); child.stderr.on("data", tail);
const exited = once(child, "exit");
try {
  const base = `http://127.0.0.1:${api}`;
  const get = (route) => fetch(`${base}${route}`, { signal: AbortSignal.timeout(1000) });
  let ready = false;
  for (let i = 0; i < 100 && child.exitCode === null; i++) {
    if (await get("/api/health").then((res) => res.ok, () => false)) { ready = true; break; }
    await delay(100);
  }
  assert(ready, logs);
  const edition = await get("/api/edition").then((res) => res.json());
  assert.equal(edition.edition, "oss");
  const brand = await get("/api/brand").then((res) => res.json());
  assert.equal(brand.brand.name, "Yarvan");
  console.log(JSON.stringify({ health: "ready", edition: edition.edition, brand: brand.brand.name }));
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  const killer = setTimeout(() => child.kill("SIGKILL"), 2500); killer.unref();
  await exited; clearTimeout(killer);
  rmSync(root, { recursive: true, force: true });
}
