import { connectPage } from "./cdp.mjs";

const targetId = process.argv[2];
if (!targetId) throw new Error("Usage: node scripts/smoke-contact-detail.mjs <local-target-id>");
const page = await connectPage(targetId, "http://127.0.0.1:5173");
const contactRoute = "/crm/org60091604256/tab/Contacts/1458063000000478808";
const listRoute = "/crm/org60091604256/tab/Contacts/custom-view/1458063000000029537/list?page=1";
const wait = (fn, timeout = 10000) => page.waitFor(fn, timeout);
try {
  await page.send("Page.navigate", { url: `http://127.0.0.1:5173${contactRoute}` });
  await wait(() => Boolean(document.querySelector(".zoho-contact-detail")));
  const report = {
    detail: await page.evaluate(() => ({
      url: location.href,
      heading: document.querySelector(".zoho-contact-heading h1")?.textContent,
      tabs: Array.from(document.querySelectorAll(".zoho-detail-tabs button")).map((node) => node.textContent?.trim()),
      sections: Array.from(document.querySelectorAll(".zoho-detail-card-heading strong")).map((node) => node.textContent?.trim()),
      relatedRows: Array.from(document.querySelectorAll(".zoho-related-row")).map((node) => node.textContent?.replace(/\s+/g, " ").trim()),
    })),
  };
  await page.evaluate(() => document.querySelector(".zoho-detail-tabs button:nth-child(3)")?.click());
  await wait(() => Boolean(document.querySelector(".zoho-related-lists")));
  report.relatedLists = await page.evaluate(() => Array.from(document.querySelectorAll(".zoho-related-lists button")).map((node) => node.textContent?.replace(/\s+/g, " ").trim()));
  await page.evaluate(() => document.querySelector(".zoho-detail-breadcrumb button")?.click());
  await wait(() => location.pathname.includes("/custom-view/") && !document.querySelector(".zoho-contact-detail"));
  report.afterClose = await page.evaluate(() => location.href);
  await page.send("Page.navigate", { url: `http://127.0.0.1:5173${contactRoute}` });
  await wait(() => Boolean(document.querySelector(".zoho-contact-detail")));
  await page.evaluate(() => document.querySelector(".zoho-detail-header-actions .small-primary")?.click());
  await wait(() => Boolean(document.querySelector("[role=dialog]")));
  report.editDialog = await page.evaluate(() => ({ title: document.querySelector("[role=dialog] h2")?.textContent, fieldCount: document.querySelectorAll("[role=dialog] input, [role=dialog] select, [role=dialog] textarea").length }));
  await page.evaluate(() => document.querySelector("[role=dialog] .secondary-button")?.click());
  await wait(() => !document.querySelector("[role=dialog]"));
  await page.evaluate(() => document.querySelector(".zoho-detail-header-actions .small-primary")?.click());
  await wait(() => Boolean(document.querySelector("[role=dialog]")));
  await page.evaluate(() => {
    const input = document.querySelector('[role="dialog"] input[aria-label="Department"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Department field is missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Operations");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.evaluate(() => {
    const save = Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent?.includes("Save changes"));
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save changes button is missing");
    save.click();
  });
  await wait(() => Boolean(document.querySelector(".zoho-contact-detail")) && document.body.innerText.includes("Operations"));
  report.afterSave = await page.evaluate(() => ({ url: location.href, saved: document.body.innerText.includes("Operations") }));
  const history = await page.send("Page.getNavigationHistory");
  const listEntry = [...history.entries].reverse().find((entry, index) => entry.url.includes("/custom-view/") && history.currentIndex - index > 0);
  if (!listEntry) throw new Error("Could not find a prior Contacts list history entry");
  await page.send("Page.navigateToHistoryEntry", { entryId: listEntry.id });
  await wait(() => location.pathname.includes("/custom-view/") && !document.querySelector(".zoho-contact-detail"));
  report.afterBack = await page.evaluate(() => location.href);
  const forwardHistory = await page.send("Page.getNavigationHistory");
  const detailEntry = forwardHistory.entries.slice(forwardHistory.currentIndex + 1).find((entry) => entry.url.endsWith(`/Contacts/1458063000000478808`));
  if (!detailEntry) throw new Error("Could not find a forward Contact detail history entry");
  await page.send("Page.navigateToHistoryEntry", { entryId: detailEntry.id });
  await wait(() => Boolean(document.querySelector(".zoho-contact-detail")));
  report.afterForward = await page.evaluate(() => location.href);
  console.log(JSON.stringify(report, null, 2));
} finally { page.close(); }
