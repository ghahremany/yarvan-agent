import { expect, it } from "vitest";
import { createBrowserDemonstration, demonstrationDraft, safeDemoOrigin } from "./browser-demonstration";

it("projects only human click, scroll and input presence into an editable draft", () => {
  const record = createBrowserDemonstration("https://work.example/secret-path?token=secret-query#secret-anchor");
  record.add({ type: "mouse", action: "up", button: "left", x: 233, y: 200, clickCount: 1, buttons: 0, modifiers: 0 });
  record.add({ type: "text", text: "password-typed-here" });
  record.add({ type: "key", action: "down", key: "p", code: "KeyP", text: "p", modifiers: 0 });
  record.add({ type: "dialog", accept: true, promptText: "private-dialog-contents" });
  record.add({ type: "authAnswer", tabId: "t", id: "a", username: "PRIVATE_LOGIN", password: "PRIVATE_PASSWORD" });
  record.add({ type: "wheel", deltaX: 0, deltaY: 70, x: 2, y: 3, modifiers: 0 });
  const steps = record.steps();
  expect(steps).toEqual([{ kind: "page", origin: "https://work.example" }, { kind: "click", x: 232, y: 200 }, { kind: "input" }, { kind: "scroll", direction: "down" }]);
  expect(demonstrationDraft(steps)).toContain("locate by label, not coordinate");
  expect(demonstrationDraft(steps)).not.toMatch(/PRIVATE|secret-|password-typed|private-dialog/);
});

it("drops unsupported and credential-bearing origins; stops storage at a deadline", () => {
  expect(safeDemoOrigin("file:///Users/somebody/notes.txt")).toBeUndefined();
  expect(safeDemoOrigin("https://name:secret@example.local")).toBeUndefined();
  let now = 2;
  const record = createBrowserDemonstration("about:blank", now, () => now);
  record.add({ type: "text", text: "invisible" });
  record.page("https://docs.example/new");
  now += 310_000;
  record.add({ type: "text", text: "expired" });
  expect(record.full).toBe(true);
  expect(record.steps()).toEqual([{ kind: "page", origin: "https://docs.example" }]);
});
