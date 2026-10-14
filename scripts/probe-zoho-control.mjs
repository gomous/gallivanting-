import { connectPage } from "./cdp.mjs";
import { writeFile } from "node:fs/promises";

// Probe one live Contacts-list control by its stable Zoho data-zcqa marker.
// This records UI state and request metadata only; it does not apply filters,
// sort settings, or any record mutation.
const [targetId, qa, output] = process.argv.slice(2);
const allowed = new Set(["lv_filterStatus", "sortView", "cv_tools", "fetchdate_title", "moreActions", "listView_addColumn", "importButton"]);
if (!allowed.has(qa)) throw new Error(`Unsupported non-mutating control: ${qa}`);
const page = await connectPage(targetId, "https://crm.zoho.in");
const requests = [];
let phase = "after-click";
const isRelevant = (url) => url.origin === "https://crm.zoho.in" && ["XHR", "Fetch", "Document"].includes(url.type);
const selectorFor = (controlQa) => controlQa === "importButton" ? "#importButton" : `[data-zcqa="${controlQa}"]`;
page.onEvent(({ method, params }) => {
  if (method === "Network.requestWillBeSent") {
    const url = new URL(params.request.url);
    if (!isRelevant({ origin: url.origin, type: params.type })) return;
    requests.push({ requestId: params.requestId, phase, method: params.request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), type: params.type, hasBody: Boolean(params.request.hasPostData) });
  }
  if (method === "Network.responseReceived") {
    const request = requests.findLast((entry) => entry.requestId === params.requestId);
    if (request) request.status = params.response.status;
  }
});
const state = async () => page.evaluate((controlQa) => {
  const text = (node) => (node?.innerText ?? node?.textContent ?? "").replace(/\s+/g, " ").trim();
  const visible = (node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0; };
  const candidates = Array.from(document.querySelectorAll("[data-zcqa],lyte-menu-item,[role=menuitem],[role=option],lyte-popover-content,lyte-modal"));
  return {
    url: location.href,
    bodyHead: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1800),
    control: Array.from(document.querySelectorAll(controlQa === "importButton" ? "#importButton" : `[data-zcqa="${controlQa}"]`)).map((node) => ({ tag: node.tagName, text: text(node), role: node.getAttribute("role"), rect: node.getBoundingClientRect().toJSON(), html: node.outerHTML.slice(0, 500) })),
    visibleMenus: candidates.filter((node) => visible(node) && (node.tagName === "LYTE-MENU-ITEM" || node.getAttribute("role") === "menuitem" || node.getAttribute("role") === "option" || /menu|popover/i.test(node.tagName))).map((node) => ({ tag: node.tagName, qa: node.getAttribute("data-zcqa"), role: node.getAttribute("role"), text: text(node) })).filter((item) => item.text).slice(-80),
  };
}, qa);
try {
  await page.send("Network.enable");
  await page.waitFor((controlQa) => Boolean(location.pathname.includes("/tab/Contacts/custom-view/") && document.querySelector(controlQa === "importButton" ? "#importButton" : `[data-zcqa="${controlQa}"]`)), 20000, qa);
  const before = await state();
  phase = "after-click";
  const rect = await page.evaluate((controlQa) => {
    const node = document.querySelector(controlQa === "importButton" ? "#importButton" : `[data-zcqa="${controlQa}"]`);
    if (!node) throw new Error(`Missing ${controlQa}`);
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, qa);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: rect.x, y: rect.y });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: rect.x, y: rect.y });
  await new Promise((resolve) => setTimeout(resolve, qa === "fetchdate_title" ? 3500 : 700));
  const after = await state();
  const evidence = { capturedAt: new Date().toISOString(), provider: "direct-CDP-live-probe", targetId, qa, before, after, requests, limitations: ["Request association is temporal, not handler-level causality.", "No response bodies, credentials, headers, or record values captured.", "No filter/sort Apply and no record mutation executed."] };
  if (output) await writeFile(output, JSON.stringify(evidence, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ qa, before: { url: before.url, control: before.control }, after: { url: after.url, control: after.control, visibleMenus: after.visibleMenus }, requests, output }, null, 2));
} finally { page.close(); }
