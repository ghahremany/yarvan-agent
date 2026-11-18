import { join } from "node:path";
import { homedir } from "node:os";
import { acquireTelegramCursor, createTelegramBridge, telegramConfig } from "../server/telegram/private-dm.ts";

const abort = new AbortController();
process.on("SIGINT", () => abort.abort());
process.on("SIGTERM", () => abort.abort());
try {
  const config = telegramConfig(process.env, process.env.OMB_DATA_DIR || join(homedir(), ".openmausbot"));
  const cursor = acquireTelegramCursor(config);
  try {
    const bridge = createTelegramBridge(config, { save: cursor.save, signal: abort.signal, log: () => console.warn("Telegram request failed; retrying without logging message content.") });
    await bridge.run(cursor.cursor);
  } finally { cursor.release(); }
} catch {
  if (!abort.signal.aborted) {
    console.error("Private Telegram did not start. Check the local receiver, dedicated bot settings, credentials, and whether another worker is running.");
    process.exitCode = 1;
  }
}
