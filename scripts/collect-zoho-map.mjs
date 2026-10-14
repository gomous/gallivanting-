import { writeFile } from "node:fs/promises";
import { connectPage } from "./cdp.mjs";

// Passive, read-only inventory of the currently authenticated Zoho CRM shell.
// Usage: node scripts/collect-zoho-map.mjs <zoho-target-id> <output-json>
const [targetId, output] = process.argv.slice(2);
if (!targetId || !output) throw new Error("Usage: node scripts/collect-zoho-map.mjs <zoho-target-id> <output-json>");
const page = await connectPage(targetId, "https://crm.zoho.in");
await page.waitFor(() => Boolean(document.body && document.body.innerText.trim() !== "Loading"), 20000);
await new Promise((resolve) => setTimeout(resolve, 2000));
const moduleRoutes = await page.evaluate(() => [...document.querySelectorAll("a[href]")]
  .map((node) => ({ label: (node.textContent ?? "").replace(/\s+/g, " ").trim(), href: node.getAttribute("href") }))
  .filter((item) => item.href?.includes("/crm/org") && item.label && !item.label.includes("Zoho")));
const uniqueRoutes = [...new Map(moduleRoutes.map((item) => [item.label, item])).values()];

function visible(node) {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
    && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
}

function cleanText(value) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

async function inspectCurrent() {
  return page.evaluate((visibleSource, cleanTextSource) => {
    const visible = new Function(`return (${visibleSource})`)();
    const cleanText = new Function(`return (${cleanTextSource})`)();
    const controls = [...document.querySelectorAll("button,[role=button],[role=menuitem],[role=option],[data-zcqa],lyte-button,lyte-menu-item,lyte-dropdown,lyte-nav-item")]
      .filter(visible)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        text: cleanText(node.textContent),
        label: cleanText(node.getAttribute("aria-label")),
        title: cleanText(node.getAttribute("title")),
        qa: node.getAttribute("data-zcqa"),
        id: node.id || null,
        role: node.getAttribute("role"),
      }))
      .filter((item) => item.text || item.label || item.title || item.qa || item.id)
      .filter((item) => !/^\d+$/.test(item.text ?? ""));
    const groups = [...document.querySelectorAll("lyte-accordion-header,[data-zcqa^=tsLeftMenuFolder_]")]
      .filter(visible).map((node) => cleanText(node.textContent)).filter(Boolean);
    const modules = [...document.querySelectorAll("[id^=moduleId_]")]
      .filter(visible).map((node) => cleanText(node.textContent)).filter(Boolean);
    const headings = [...document.querySelectorAll("h1,h2,h3,[role=heading]")]
      .filter(visible).map((node) => cleanText(node.textContent)).filter(Boolean).slice(0, 40);
    const forms = [...document.querySelectorAll("input:not([type=hidden]),select,textarea")]
      .filter(visible).map((node) => ({ tag: node.tagName.toLowerCase(), type: node.type || null, label: cleanText(node.getAttribute("aria-label")), placeholder: cleanText(node.getAttribute("placeholder")), name: node.name || null }));
    return { title: document.title, url: location.href, groups, modules, headings, controls, forms };
  }, visible.toString(), cleanText.toString());
}

const pages = [];
try {
  await page.send("Network.enable");
  for (const route of uniqueRoutes) {
    if (!route.href) continue;
    await page.send("Page.navigate", { url: new URL(route.href, "https://crm.zoho.in").href });
    await page.waitFor(() => Boolean(document.body && document.body.innerText.trim() !== "Loading"), 20000);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    pages.push({ module: route.label, requestedPath: route.href, ...(await inspectCurrent()) });
  }
  const result = {
    capturedAt: new Date().toISOString(),
    authority: "passive authenticated Zoho CRM browser inspection",
    targetId,
    routeCount: pages.length,
    pages,
    limitations: [
      "Read-only attach-window inventory; no record create, update, delete, import, export, or submit operation was performed.",
      "Only currently visible controls were retained; hidden menu contents and lazy-loaded sections require separate observation windows.",
      "Record values and credentials were not retained; labels, locators, routes, and structural controls were retained.",
    ],
  };
  await writeFile(output, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ output, routeCount: pages.length, modules: pages.map((page) => page.module) }, null, 2));
} finally { page.close(); }
