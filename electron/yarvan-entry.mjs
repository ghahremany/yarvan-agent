// Yarvan's installed entry. Keep an actionable startup error even when Explorer
// or a desktop launcher gives the process no visible stderr.
import { app } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

try {
  await import("./main.mjs");
} catch (error) {
  const message = String(error?.stack ?? error);
  try {
    const logs = app.getPath("logs");
    mkdirSync(logs, { recursive: true });
    appendFileSync(join(logs, "startup-errors.log"), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
    if (process.env.OMB_SMOKE_TEST === "1" && process.env.YARVAN_SMOKE_REPORT) {
      writeFileSync(process.env.YARVAN_SMOKE_REPORT + ".error", message, { flag: "wx", mode: 0o600 });
    }
  } catch {}
  throw error;
}
