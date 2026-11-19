// Launch the installed native executable, exercise its preload, local server and built UI.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const executable = resolve(process.argv[2] ?? "");
assert(process.argv[2] && existsSync(executable), "Pass the path of the installed Yarvan executable.");
const resources = join(dirname(executable), "resources");
for (const name of ["app-update.yml", "server/enterprise", "cua-linux-x64", "cua-driver.exe"]) assert(!existsSync(join(resources, name)), `Unexpected resource: ${name}`);
const { version } = JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8"));
const root = mkdtempSync(join(tmpdir(), "yarvan-desktop-smoke-"));
const home = join(root, "home");
const profile = join(root, "electron-profile");
const chromiumLog = join(root, "chromium.log");
const report = join(root, "report.json");
for (const path of [home, join(home, "AppData", "Roaming"), join(home, "AppData", "Local"), profile]) {
  mkdirSync(path, { recursive: true });
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:OMB_|OGB_|YARVAN_|ELECTRON_|NODE_OPTIONS)/.test(key)));
Object.assign(env, {
  HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
  XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share"),
  OMB_SMOKE_TEST: "1", OMB_DISABLE_ANNOUNCEMENTS: "1", OMB_DISABLE_MODEL_MANIFEST_FETCH: "1", OMB_DISABLE_MODEL_CATALOG_FETCH: "1",
  YARVAN_SMOKE_REPORT: report,
});
const child = spawn(executable, ["--user-data-dir=" + profile, "--disable-gpu", "--enable-logging=file", "--log-file=" + chromiumLog], {
  cwd: root, env, detached: process.platform === "linux", stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
const tail = (chunk) => { logs = (logs + chunk).slice(-16000); };
child.stdout.on("data", tail);
child.stderr.on("data", tail);
const stopped = once(child, "exit");
stopped.catch(() => {});
try {
  for (let i = 0; i < 280 && !existsSync(report) && child.exitCode === null && !existsSync(report + ".error"); i++) await delay(250);
  if (!existsSync(report)) {
    for (const file of [report + ".error", join(profile, "logs", "server.log"), join(profile, "logs", "desktop-crashes.log"), chromiumLog]) {
      try { logs += `\n${file}:\n${readFileSync(file, "utf8").slice(-4000)}`; } catch {}
    }
  }
  assert(existsSync(report), `Packaged renderer did not start (process exit ${child.exitCode}).\n${logs}`);
  const data = JSON.parse(readFileSync(report, "utf8"));
  assert.deepEqual(data.release, { edition: "oss", name: "Yarvan", rendered: true, version });
  assert.match(data.location, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert(existsSync(join(home, ".yarvan")), "Yarvan did not create its independent data directory.");
  assert(!existsSync(join(home, ".openmausbot")));
  console.log(JSON.stringify({ result: "passed", location: data.location, ...data.release }));
} finally {
  if (child.pid && child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true });
    else try { process.kill(-child.pid, "SIGTERM"); } catch {}
    await Promise.race([stopped, delay(4000)]).catch(() => {});
    if (process.platform === "linux" && child.exitCode === null) try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 160 });
}
