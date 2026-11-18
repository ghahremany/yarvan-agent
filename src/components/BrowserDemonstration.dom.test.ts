// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { ControlTransport } from "@/lib/browser-control";
import type { PreviewStreamClient, PreviewStreamControl, PreviewStreamInput } from "@/lib/browser-stream-client";
import type { StreamSurface } from "./browser/StreamSurface";
import type { ComponentProps } from "react";

const fixture = vi.hoisted(() => ({ api: vi.fn(), options: { pinnedMemory: true, browserEngine: { engine: "chrome" } } }));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { config: fixture.options, computerControl: {} } }) }));
vi.mock("@/lib/page-visible", () => ({ usePageVisible: () => true }));
vi.mock("@/lib/browser-pip", () => ({ useBrowserPictureInPicture: () => "", supportsBrowserPictureInPicture: () => false }));
vi.mock("./BrowserProfilesManager", () => ({ BrowserProfilesManager: () => null }));
let surface: ComponentProps<typeof StreamSurface>;
vi.mock("./browser/StreamSurface", () => ({ StreamSurface: (props: ComponentProps<typeof StreamSurface>) => {
  surface = props;
  return createElement("div", { "aria-label": props.label });
} }));

const { LiveBrowser } = await import("./BrowserPanel");
const bot: Bot = {
  id: "scout", threadId: "thread-scout", name: "Scout", title: "Researcher", description: "", soul: "", browserProfile: "guest",
  notifications: true, color: "green", unread: false, messages: [], modelSelection: { instanceId: "claude", model: "claude-sonnet" },
};

let host: HTMLDivElement, root: Root;
const button = (name: string) => [...host.querySelectorAll("button")].find((el) => el.textContent?.trim() === name);
const click = (el: HTMLButtonElement | undefined | null) => {
  if (!el || el.disabled) throw new Error("Expected an enabled browser button.");
  flushSync(() => el.click());
};
const draft = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Demonstration draft"]');
const setControl = (controller: PreviewStreamControl["controller"]) => surface.onControl?.({ controller, canOperate: true, generation: 1, dialog: null });
const input = (event: PreviewStreamInput) => flushSync(() => surface.input(event));
const point = (action: "down" | "up"): PreviewStreamInput => ({ type: "mouse", action, button: "left", buttons: action === "down" ? 1 : 0, x: 91, y: 114, clickCount: 1, modifiers: 0 });

beforeEach(() => {
  fixture.api.mockReset().mockResolvedValue({});
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(LiveBrowser, { bot })));
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

async function takeBrowser() {
  const transport: ControlTransport = {
    send: vi.fn(), size: () => 0, stopped: () => false, settle: async () => {}, drain: async () => {}, release: async () => {},
    take: async () => { flushSync(() => setControl("you")); return { waited: false }; },
  };
  flushSync(() => {
    surface.onClient?.({ transport } as unknown as PreviewStreamClient);
    surface.onConnectedChange?.(true);
    setControl("agent");
    surface.onMessage?.({ type: "nav", url: "https://example.test/account?fixture=DO-NOT-COPY#secret-fragment" });
  });
  expect(button("Start demonstration")?.disabled).toBe(true);
  click(host.querySelector<HTMLButtonElement>("button[data-pill=bot]"));
  await vi.waitFor(() => expect(button("Start demonstration")?.disabled).toBe(false));
  return transport;
}

it("requires takeover, records only a reduced trace, and saves the edited draft disabled", async () => {
  const transport = await takeBrowser();
  click(button("Start demonstration"));
  input(point("down")); input(point("up"));
  input({ type: "text", text: "PRIVATE-TYPED-FIXTURE-638" });
  expect(transport.send).toHaveBeenCalledWith({ type: "text", text: "PRIVATE-TYPED-FIXTURE-638" });
  click(button("Stop and review"));
  expect(draft()?.value).toContain("https://example.test");
  expect(draft()?.value).toContain("observed near");
  expect(draft()?.value).toContain("sample value was not recorded");
  expect(draft()?.value).not.toMatch(/account|DO-NOT-COPY|secret-fragment|PRIVATE-TYPED/);
  const editor = draft()!;
  flushSync(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, `${editor.value}\nExpected result: the sample heading is visible.`); editor.dispatchEvent(new Event("input", { bubbles: true })); });
  click(button("Save as disabled skill"));
  await vi.waitFor(() => expect(host.textContent).toContain("Disabled skill saved"));
  expect(fixture.api).toHaveBeenCalledTimes(1);
  const [path, config] = fixture.api.mock.calls[0]!;
  expect(path).toBe("/api/bots/scout/skill-template");
  expect(JSON.parse(config.body)).toMatchObject({ source: "yarvan-browser-demonstration", enabled: false, text: expect.stringContaining("sample heading is visible") });
  expect(config.body).not.toMatch(/DO-NOT-COPY|PRIVATE-TYPED/);
});

it("stops when the hold is lost and never records in a persistent profile", async () => {
  await takeBrowser();
  click(button("Start demonstration"));
  input(point("down")); input(point("up"));
  flushSync(() => setControl("another-viewer"));
  const snapshot = draft()?.value;
  expect(snapshot).toContain("observed near");
  input({ type: "text", text: "Do not record after relinquishing control" });
  expect(draft()?.value).toBe(snapshot);
  flushSync(() => root.render(createElement(LiveBrowser, { bot: { ...bot, browserProfile: "profile-owned" } })));
  expect(host.querySelector('[aria-label="Teach in this browser"]')).toBeNull();
  expect(fixture.api).not.toHaveBeenCalled();
});
