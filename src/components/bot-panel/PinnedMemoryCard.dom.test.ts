// @vitest-environment happy-dom
// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PinnedMemorySnapshot } from "../../../shared/pinned-memory";
import { PinnedMemoryCard } from "./PinnedMemoryCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let snapshot: PinnedMemorySnapshot;
let writes: PinnedMemorySnapshot[];
let failLoad: boolean;

beforeEach(() => {
  snapshot = { revision: "initial", blocks: [] };
  writes = [];
  failLoad = false;
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    expect(input).toBe("/api/bots/scout/memory/pinned");
    if (init?.method !== "PUT") return failLoad ? reply(500, { error: "injected read failure" }) : reply(200, snapshot);
    const write = JSON.parse(String(init.body)) as PinnedMemorySnapshot;
    writes.push(write);
    if (write.revision !== snapshot.revision) return reply(409, { error: "changed", current: snapshot });
    snapshot = { revision: `write-${writes.length}`, blocks: write.blocks };
    return reply(200, snapshot);
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const open = (enabled = true) => act(async () => root.render(createElement(PinnedMemoryCard, { botId: "scout", enabled })));
const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
};
const type = (selector: "input" | "textarea", value: string) => act(() => {
  const field = host.querySelector(selector)!;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});

it("adds, edits, deletes, and undoes a pinned block with no page reload", async () => {
  await open();
  await click("Pin a block");
  expect(document.activeElement).toBe(host.querySelector("input"));
  type("input", "Preferences");
  type("textarea", "پاسخ کوتاه باشد.");
  await click("Add");
  expect(writes[0]?.revision).toBe("initial");
  expect(host.querySelector("[data-pinned-memory-block]")?.textContent).toContain("پاسخ کوتاه باشد.");
  await click("Edit Preferences");
  type("textarea", "Short replies with examples.");
  await click("Save");
  expect(snapshot.blocks[0]?.text).toBe("Short replies with examples.");
  await click("Delete Preferences");
  expect(snapshot.blocks).toEqual([]);
  await click("Undo");
  expect(snapshot.blocks[0]?.text).toBe("Short replies with examples.");
});

it("shows the newest list and keeps an unsaved draft on a conflict", async () => {
  const original = { id: "existing", title: "Preferences", text: "Original" };
  snapshot = { revision: "initial", blocks: [original] };
  await open();
  await click("Edit Preferences");
  type("textarea", "My draft");
  snapshot = { revision: "elsewhere", blocks: [{ ...original, text: "Saved elsewhere" }] };
  await click("Save");
  expect(snapshot.blocks[0]?.text).toBe("Saved elsewhere");
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Nothing was saved");
  expect(host.querySelector("[data-pinned-memory-block]")?.textContent).toContain("Saved elsewhere");
  expect(host.querySelector("textarea")?.value).toBe("My draft");
});

it("lets the owner retry a read and review saved notes while memory is off", async () => {
  failLoad = true;
  snapshot = { revision: "stored", blocks: [{ id: "earlier", title: "Preferences", text: "Already saved" }] };
  await open(false);
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Couldn't load");
  failLoad = false;
  await click("Try again");
  expect(host.textContent).toContain("Memory is off");
  expect(host.textContent).toContain("Already saved");
});
