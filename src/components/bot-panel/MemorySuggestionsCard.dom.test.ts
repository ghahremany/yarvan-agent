// @vitest-environment happy-dom
// Modified for Yarvan; see UPSTREAM.md for attribution and docs/yarvan/modified-files.md for changes.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { MemorySuggestionQueue } from "../../../shared/memory-suggestions";
import { MemorySuggestionsCard } from "./MemorySuggestionsCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("is per bot, shows the evidence, and only saves a suggestion on approval", async () => {
  const bot = { id: "scout", name: "Scout", tasks: [{ threadId: "source", title: "A chat" }] } as Bot;
  const pending = [
    { id: "approved", text: "Likes coffee", quote: "I like coffee.", threadId: "source", at: Date.now(), via: "capture" as const },
    { id: "rejected", text: "Likes tea", quote: "I like tea.", threadId: "source", at: Date.now(), via: "capture" as const },
  ];
  let queue: MemorySuggestionQueue = { enabled: false, pending: [] };
  const writes: object[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    expect(input).toBe("/api/bots/scout/memory/suggestions");
    if (init?.method === "PUT" || init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      queue = init.method === "PUT" ? { enabled: body.enabled, pending } : { ...queue, pending: queue.pending.filter((item) => item.id !== body.id) };
    }
    return new Response(JSON.stringify(queue));
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host), changed = vi.fn();
  try {
    await act(async () => root.render(createElement(MemorySuggestionsCard, { bot, onApproved: changed })));
    await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(host.textContent).toContain("I like tea.");
    expect(host.textContent).toContain("A chat");
    expect(changed).not.toHaveBeenCalled();
    const actOn = (id: string, label: string) => act(async () => {
      const item = [...host.querySelectorAll("[data-memory-suggestion]")].find((row) => row.textContent?.includes(id));
      [...item!.querySelectorAll("button")].find((button) => button.textContent === label)!.click();
    });
    await actOn("Likes tea", "Reject");
    expect(changed).not.toHaveBeenCalled();
    await actOn("Likes coffee", "Approve and save");
    expect(changed).toHaveBeenCalledOnce();
    expect(writes).toEqual([{ enabled: true }, { id: "rejected", decision: "reject" }, { id: "approved", decision: "approve" }]);
    expect(host.textContent).toContain("No pending suggestions");
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
