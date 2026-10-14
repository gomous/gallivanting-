import { connectPage, controlsSnapshot } from "./cdp.mjs";
import { writeFile } from "node:fs/promises";

// Usage: node scripts/probe-live.mjs <target-id> <inspect|toolbar-label|nav:label> [new-output.json]
// Only observed navigation links and non-submitting toolbar controls may be clicked.
const [targetId, action = "inspect", output] = process.argv.slice(2);
const page = await connectPage(targetId, "https://crm.zoho.in");
const requests = [];
let phase = "baseline";
page.onEvent(({ method, params }) => {
  if (method === "Network.requestWillBeSent") {
    const url = new URL(params.request.url);
    if (url.origin !== "https://crm.zoho.in" || !["XHR", "Fetch", "Document"].includes(params.type)) return;
    const query = Object.fromEntries([...url.searchParams].map(([key, value]) => [key, /token|auth|secret|password|code|email/i.test(key) ? "[excluded]" : value]));
    requests.push({ requestId: params.requestId, phase, at: params.timestamp, method: params.request.method, path: url.pathname, query, type: params.type, hasBody: Boolean(params.request.hasPostData) });
  }
  if (method === "Network.responseReceived") {
    const request = requests.findLast((entry) => entry.requestId === params.requestId);
    if (request) request.status = params.response.status;
  }
});
try {
  await page.send("Network.enable");
  await page.waitFor(() => Boolean(document.body.innerText.trim() !== "Loading" && document.querySelector("a[href*='/tab/Contacts']")));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const before = await page.evaluate(controlsSnapshot);
  let clicked = null;
  if (action !== "inspect") {
    if (!action.startsWith("nav:") && !["Sort", "Filter", "More", "Actions", "View Settings", "Refresh Custom View", "Create Contact", "Cancel", "All Contacts"].includes(action)) throw new Error("Action is outside the non-submitting probe list");
    phase = action;
    clicked = await page.evaluate((label) => {
      const navigation = label.startsWith("nav:");
      const expected = navigation ? label.slice(4) : label;
      const nodes = Array.from(document.querySelectorAll(navigation ? "a[href*='/tab/']" : "button,[role=button],[role=menu],[data-zcqa],lyte-button,lyte-menu-item,lyte-dropdown"));
      const matches = nodes.filter((node) => {
        const rect = node.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth)) return false;
        const nodeText = node.innerText?.replace(/\s+/g, " ").trim() ?? "";
        const strippedText = nodeText.replace(/^[^\p{L}\p{N}]*/u, "").trim();
        return [node.getAttribute("aria-label"), node.getAttribute("title"), nodeText, strippedText].includes(expected);
      });
      if (matches.length !== 1) throw new Error(`Expected one ${expected} control, found ${matches.length}`);
      const node = matches[0];
      node.click();
      return { label: expected, tag: node.tagName, qa: node.getAttribute("data-zcqa"), href: node.getAttribute("href") };
    }, action);
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await page.waitFor(() => document.body.innerText.trim() !== "Loading");
  }
  const after = await page.evaluate(controlsSnapshot);
  const evidence = { capturedAt: new Date().toISOString(), provider: "direct-CDP-live-probe", targetId, action, clicked, before, after, requests, limitations: ["Requests are temporally associated, not handler-level causality.", "Attach-window only; cached responses may yield no request.", "No credentials, header values, response bodies or record values captured.", "No record save/delete operations executed."] };
  if (output) await writeFile(output, JSON.stringify(evidence, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ action, clicked, url: after.url, controls: after.controls, forms: after.forms, requests, output }, null, 2));
} finally { page.close(); }
