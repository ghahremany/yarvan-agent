import type { PreviewStreamInput } from "./browser-stream-client";

export type DemoStep =
  | { kind: "page"; origin: string }
  | { kind: "click"; x: number; y: number }
  | { kind: "scroll"; direction: "up" | "down" | "left" | "right" }
  | { kind: "input" };

const MAX_MS = 5 * 60_000;
const MAX_STEPS = 100;

export function safeDemoOrigin(page: string): string | undefined {
  try {
    const url = new URL(page);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return undefined;
    return url.origin.slice(0, 300);
  } catch { return undefined; }
}

/** Record only the projection, never a browser frame, page content, typed value, clipboard, dialog or full URL. */
export function createBrowserDemonstration(startPage: string, start = Date.now(), now = Date.now) {
  const rows: DemoStep[] = [];
  let origin: string | undefined;
  let expired = false;
  const append = (step: DemoStep) => {
    if (expired || now() - start >= MAX_MS || rows.length >= MAX_STEPS) { expired = true; return; }
    const prior = rows.at(-1);
    if (step.kind === "input" && prior?.kind === "input") return;
    if (step.kind === "scroll" && prior?.kind === "scroll" && step.direction === prior.direction) return;
    rows.push(step);
  };
  const page = (url: string) => {
    const next = safeDemoOrigin(url);
    if (next && next !== origin) append({ kind: "page", origin: next });
    origin = next;
  };
  page(startPage);
  return {
    page,
    add(input: PreviewStreamInput): void {
      if (!origin || expired) return;
      if (input.type === "mouse" && input.action === "up" && input.button === "left" &&
        Number.isFinite(input.x) && Number.isFinite(input.y) && input.x >= 0 && input.y >= 0 && input.x < 8192 && input.y < 8192) {
        append({ kind: "click", x: Math.round(input.x / 8) * 8, y: Math.round(input.y / 8) * 8 });
      } else if (input.type === "wheel" && (Math.abs(input.deltaX) > 8 || Math.abs(input.deltaY) > 8)) {
        append({ kind: "scroll", direction: Math.abs(input.deltaY) >= Math.abs(input.deltaX) ? (input.deltaY > 0 ? "down" : "up") : (input.deltaX > 0 ? "right" : "left") });
      } else if (input.type === "text" || (input.type === "key" && input.action === "down" && input.text)) append({ kind: "input" });
    },
    get size() { return rows.length; },
    get full() { return expired || rows.length >= MAX_STEPS || now() - start >= MAX_MS; },
    steps: () => rows.map((row) => ({ ...row })),
  };
}

export function demonstrationDraft(steps: readonly DemoStep[]): string {
  const line = (step: DemoStep) => {
    switch (step.kind) {
      case "page": return `Work on ${step.origin} (confirm that it is the intended site).`;
      case "click": return `Select [describe the control here] (observed near ${step.x}, ${step.y} CSS pixels; locate by label, not coordinate).`;
      case "scroll": return `Scroll ${step.direction} until [describe the expected content].`;
      case "input": return "Fill [describe the field] with an authorized input supplied for this run. The sample value was not recorded.";
    }
  };
  return ["## Outcome", "Describe the desired result, eligible page and test input.", "", "## Observed steps", ...steps.map((step, index) => `${index + 1}. ${line(step)}`), "", "## Checks", "Rehearse with test data. Pause for the person at sign-in, permissions, purchases, submissions or destructive steps. Verify page labels and the expected result before finishing."].join("\n");
}
