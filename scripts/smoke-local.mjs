import { connectPage } from "./cdp.mjs";

const targetId = process.argv[2] ?? "474AF30F7A56164EABADF544170403CB";
const page = await connectPage(targetId, "http://127.0.0.1:5173");
const exactButton = async (label) => page.evaluate((expected) => {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
    const labels = (candidate.innerText ?? "").split(/\s+/).filter(Boolean);
    return labels.at(-1) === expected || (candidate.getAttribute("aria-label") ?? "") === expected;
  });
  if (!button) throw new Error(`Missing button: ${expected}`);
  button.click();
  return expected;
}, label);

try {
  const report = { before: page.target.url };
  await exactButton("Contacts");
  await page.waitFor(() => location.pathname.includes("/tab/Contacts/custom-view/"));
  report.contactsList = await page.evaluate(() => location.href);

  await page.evaluate(() => {
    const row = document.querySelector("tbody tr");
    if (!row) throw new Error("Missing Contacts row");
    row.click();
  });
  await page.waitFor(() => location.pathname.includes("/tab/Contacts/") && !location.pathname.includes("custom-view") && !location.pathname.endsWith("/create"));
  report.detail = await page.evaluate(() => location.href);

  await page.evaluate(() => (document.querySelector(".zoho-detail-breadcrumb button") ?? document.querySelector(".close-button"))?.click());
  await page.waitFor(() => location.pathname.includes("/tab/Contacts/custom-view/"));
  report.afterClose = await page.evaluate(() => location.href);

  await exactButton("Create Contact");
  await page.waitFor(() => location.pathname.endsWith("/tab/Contacts/create"));
  report.create = await page.evaluate(() => location.href);

  await exactButton("Cancel");
  await page.waitFor(() => location.pathname.includes("/tab/Contacts/custom-view/"));
  report.afterCancel = await page.evaluate(() => location.href);
  console.log(JSON.stringify(report, null, 2));
} finally {
  page.close();
}
