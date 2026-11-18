// @vitest-environment happy-dom
// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { PinnedMemorySnapshot } from "../../shared/pinned-memory";
import { ChatMemoryDialog, pinFromMessage, ReplyMemory, type ChatMemoryEdit } from "./ChatMemory";
import { MessageActions } from "./MessageActions";

vi.mock("@/state/store", async (load) => ({ ...await load<typeof import("@/state/store")>(), useStoreDispatch: () => vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const bot = {
  id: "scout", name: "Scout", color: "blue", threadId: "here", tasks: [{ threadId: "here", projectId: "narvan" }],
  projects: [{ id: "narvan", name: "Narvan" }, { id: "anaar", name: "Anaar" }],
} as Bot;
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

it("uses just the selection in that message, then lets the person edit the pin before saving", async () => {
  const open = vi.fn<(edit: ChatMemoryEdit) => void>();
  await act(async () => root.render(createElement("div", { "data-message-row": "" },
    createElement("div", { "data-chat-bubble": "" }, "Before selected text after"),
    createElement(MessageActions, { side: "user", menu: pinFromMessage("Before selected text after", open) }))));
  const range = document.createRange(), node = host.querySelector("[data-chat-bubble]")!.firstChild!;
  range.setStart(node, 7); range.setEnd(node, 20);
  window.getSelection()!.addRange(range);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('button[role="menuitem"]')!.click());
  expect(open).toHaveBeenCalledWith({ kind: "save", text: "selected text" });

  const writes: PinnedMemorySnapshot[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    expect(path).toBe("/api/bots/scout/memory/pinned");
    if (init?.method !== "PUT") return json({ revision: "initial", blocks: [] });
    const write = JSON.parse(String(init.body)) as PinnedMemorySnapshot;
    writes.push(write);
    return json({ ...write, revision: "updated" });
  }));
  const saved = vi.fn();
  await act(async () => root.render(createElement(ChatMemoryDialog, { bot, edit: open.mock.calls[0]![0], onClose: vi.fn(), onSaved: saved })));
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.querySelector("textarea")?.value).toBe("selected text");
  expect(dialog.querySelector("select")?.value).toBe("narvan");
  act(() => {
    const set = (selector: string, value: string) => {
      const field = dialog.querySelector(selector)!;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("input", "Edited title");
    set("textarea", "Remember only this");
  });
  expect(writes).toEqual([]);
  await act(async () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(writes[0]).toMatchObject({ revision: "initial", blocks: [{ title: "Edited title", text: "Remember only this", projectId: "narvan" }] });
  expect(saved).toHaveBeenCalledOnce();
});

it("loads a reply's record only when expanded and edits the current pin by ID", async () => {
  const fetcher = vi.fn(async () => json({ mode: "on", items: [{ kind: "pin", label: "Old title", pinId: "pin-1", text: "Old context" }] }));
  vi.stubGlobal("fetch", fetcher);
  const onEdit = vi.fn();
  await act(async () => root.render(createElement(ReplyMemory, { botId: "scout", threadId: "here", messageId: "reply", onEdit })));
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith("/api/bots/scout/tasks/here/replies/reply/memory", expect.anything());
  expect(host.textContent).toContain("Old context");
  expect(host.textContent).toContain("does not show what caused the answer");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(onEdit).toHaveBeenCalledWith({ kind: "pin", id: "pin-1" });
});

it("falls back to the bot's whole message when the selection crosses into another bubble", async () => {
  const open = vi.fn();
  await act(async () => root.render(createElement("div", null,
    createElement("div", { "data-message-row": "" }, createElement("div", { "data-chat-bubble": "" }, "Separate text")),
    createElement("div", { "data-message-row": "" }, createElement("div", { "data-chat-bubble": "" }, "Complete bot answer"),
      createElement(MessageActions, { side: "bot", menu: pinFromMessage("Complete bot answer", open) })))));
  const [before, answer] = host.querySelectorAll("[data-chat-bubble]");
  const range = document.createRange();
  range.setStart(before!.firstChild!, 2);
  range.setEnd(answer!.firstChild!, 8);
  window.getSelection()!.addRange(range);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('button[role="menuitem"]')!.click());
  expect(open).toHaveBeenCalledWith({ kind: "save", text: "Complete bot answer" });
});
