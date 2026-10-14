import assert from "node:assert/strict";
import { connectPage } from "./cdp.mjs";

// Usage: node scripts/smoke-zoho-ui-architecture.mjs <local-target-id>
const targetId = process.argv[2];
if (!targetId) throw new Error("Usage: node scripts/smoke-zoho-ui-architecture.mjs <local-target-id>");
const localOrigin = "http://127.0.0.1:5173";
const architectureUrl = `${localOrigin}/zoho-ui-architecture.html`;
const page = await connectPage(targetId, "http://127.0.0.1:5173");
const errors = [];
let captureArchitectureRequests = false;
let architectureRequests = [];
page.onEvent((event) => {
  if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails);
  if (captureArchitectureRequests && event.method === "Network.requestWillBeSent") architectureRequests.push(event.params.request.url);
});

const waitForArchitecture = () => page.waitFor(() => (
  document.title.includes("UI Architecture") &&
  document.querySelectorAll(".architecture-card").length >= 20 &&
  document.querySelectorAll(".architecture-layer").length === 5
));

const navigateToArchitecture = async () => {
  architectureRequests = [];
  captureArchitectureRequests = true;
  try {
    await page.send("Page.navigate", { url: architectureUrl });
    await waitForArchitecture();
  } catch (error) {
    captureArchitectureRequests = false;
    throw error;
  }
};

const stopArchitectureRequestCapture = () => { captureArchitectureRequests = false; };

const setSearch = (value) => page.evaluate((nextValue) => {
  const input = document.querySelector("#architecture-search");
  if (!(input instanceof HTMLInputElement)) throw new Error("Architecture search input is missing");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, nextValue);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, value);

const clickLayerJump = (layerId) => page.evaluate((id) => {
  const directControl = document.querySelector(`[data-layer-jump="${id}"]`);
  const control = directControl ?? document.querySelector("select[data-layer-jump]");
  if (!control) throw new Error(`Architecture layer jump is missing: ${id}`);
  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find((candidate) => candidate.value === id || candidate.textContent?.trim().toLowerCase().includes(id));
    if (!option) throw new Error(`Architecture layer jump option is missing: ${id}`);
    control.value = option.value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    control.click();
  }
}, layerId);

const architectureState = () => page.evaluate(() => {
  const isHidden = (node) => node.hidden || node.classList.contains("is-hidden") || getComputedStyle(node).display === "none";
  const cards = [...document.querySelectorAll(".architecture-card")].map((card) => ({
    title: card.querySelector("h4")?.textContent?.trim(),
    layerId: card.dataset.layerId,
    searchHidden: card.classList.contains("is-search-hidden"),
    selected: card.classList.contains("is-selected"),
    evidenceStatus: card.querySelector(".evidence-status")?.textContent?.trim() ?? "",
  }));
  const layers = [...document.querySelectorAll(".architecture-layer")].map((layer) => ({
    id: layer.dataset.layerId,
    dimmed: layer.classList.contains("is-dimmed"),
    hidden: isHidden(layer),
    visibleCards: [...layer.querySelectorAll(".architecture-card")].filter((card) => !card.classList.contains("is-search-hidden")).length,
  }));
  const tabs = [...document.querySelectorAll("[data-layer-tab]")].map((tab) => ({
    id: tab.dataset.layerTab,
    tagName: tab.tagName,
    ariaPressed: tab.getAttribute("aria-pressed"),
  }));
  const inspector = document.querySelector("#inspector-body");
  return {
    resultCount: document.querySelector("#result-count")?.textContent?.trim() ?? "",
    search: document.querySelector("#architecture-search")?.value ?? "",
    cards,
    layers,
    tabs,
    selectedVisibleCards: cards.filter((card) => card.selected && !card.searchHidden),
    inspectorText: inspector?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    links: document.querySelectorAll("a").length,
    forms: document.querySelectorAll("form").length,
    inlineScripts: [...document.scripts].filter((script) => !script.src).length,
    inlineStyles: document.querySelectorAll("style").length,
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? "",
    reactRoots: document.querySelectorAll("#root, [data-reactroot]").length,
    layerJumps: document.querySelectorAll("[data-layer-jump]").length,
    graphButtons: [...document.querySelectorAll("button")].filter((button) => /\bgraph\b/i.test(`${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`)).length,
    graphPanels: [...document.querySelectorAll("[id], [class], [data-view]")].filter((node) => !["BUTTON", "HTML", "BODY"].includes(node.tagName) && /\bgraph\b/i.test(`${node.id} ${typeof node.className === "string" ? node.className : ""} ${node.getAttribute("data-view") ?? ""}`)).length,
    crmActionControls: [...document.querySelectorAll("button,[role=button]")].filter((node) => !node.closest(".architecture-card") && /\b(create|save|delete|export|mass update|mass convert|manage tags|edit|actions?)\b/i.test(node.textContent ?? "")).length,
    evidenceStatusCount: cards.filter((card) => card.evidenceStatus).length,
    coverageNote: (() => {
      const note = document.querySelector("#coverage-note");
      if (!note) return { present: false, visible: false, text: "" };
      const rect = note.getBoundingClientRect();
      const style = getComputedStyle(note);
      return { present: true, visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden", text: note.textContent?.replace(/\s+/g, " ").trim() ?? "" };
    })(),
    source: document.querySelector(".source-badge")?.textContent?.trim() ?? "",
  };
});

const assertLocalRequests = (label) => {
  const remoteRequests = architectureRequests.filter((requestUrl) => {
    try {
      const url = new URL(requestUrl);
      return ["http:", "https:"].includes(url.protocol) && url.origin !== localOrigin;
    } catch { return false; }
  });
  assert.deepEqual(remoteRequests, [], `${label} must not make remote network requests`);
  assert.ok(architectureRequests.length > 0, `${label} must load through local public requests`);
};

let architectureRestored = false;
try {
  await page.send("Runtime.enable");
  await page.send("Network.enable");
  await navigateToArchitecture();

  const initial = await architectureState();
  assert.equal(initial.links, 0, "The standalone architecture page must not contain links");
  assert.equal(initial.forms, 0, "The standalone architecture page must not contain forms");
  assert.equal(initial.inlineScripts, 0, "The standalone architecture page must not use inline scripts");
  assert.equal(initial.inlineStyles, 0, "The standalone architecture page must not use inline styles");
  assert.match(initial.csp, /(?:^|;)\s*script-src\s+'self'(?:\s|;|$)/, "The standalone architecture page must keep a self-only script CSP");
  assert.doesNotMatch(initial.csp, /script-src[^;]*unsafe-inline/i, "The standalone architecture page must not allow inline scripts");
  assert.equal(initial.reactRoots, 0, "The standalone architecture page must not mount a React root");
  assert.equal(initial.crmActionControls, 0, "The standalone architecture page must not expose CRM action controls");
  assert.equal(initial.graphButtons, 0, "The standalone architecture page must not use a graph button");
  assert.equal(initial.graphPanels, 0, "The standalone architecture page must not use a graph panel");
  assert.ok(initial.cards.length >= 20);
  assert.equal(initial.layers.length, 5);
  assert.equal(initial.layerJumps > 0, true, "The standalone architecture page must expose a layer jump control");
  assert.equal(initial.source, "Zoho observations · static reference");
  assert.equal(initial.coverageNote.present, true, "The standalone architecture page must expose coverage guidance");
  assert.equal(initial.coverageNote.visible, true, "The coverage guidance must be prominent");
  assert.match(initial.coverageNote.text, /partial/i, "Coverage guidance must explain partial evidence");
  assert.match(initial.coverageNote.text, /evidence/i, "Coverage guidance must explain evidence");
  assert.equal(initial.evidenceStatusCount, initial.cards.length, "Every architecture card must have an evidence-status badge");
  assert.ok(initial.tabs.every((tab) => tab.tagName === "BUTTON" && (tab.ariaPressed === "true" || tab.ariaPressed === "false")), "Every layer tab must be a button with aria-pressed");
  assert.equal(initial.tabs.filter((tab) => tab.ariaPressed === "true").length, 1, "Exactly one layer tab must be active");
  assert.equal(initial.resultCount, `${initial.cards.length} architecture cards shown`);

  await page.evaluate(() => document.querySelector('[data-layer-tab="surface"]').click());
  await page.waitFor(() => document.querySelector('[data-layer-tab="surface"]').getAttribute("aria-pressed") === "true" && document.querySelector("#result-count").textContent === "6 architecture cards shown");
  const surface = await architectureState();
  assert.equal(surface.resultCount, "6 architecture cards shown", "The surface filter must show six architecture cards");
  assert.equal(surface.cards.filter((card) => !card.searchHidden).length, 6);
  assert.equal(surface.layers.filter((layer) => layer.visibleCards === 0).length, 4, "Empty layers must be dimmed and hidden");
  assert.ok(surface.layers.filter((layer) => layer.visibleCards === 0).every((layer) => layer.dimmed && layer.hidden), "Empty layers must be dimmed and hidden");

  await setSearch("filter");
  await page.waitFor(() => document.querySelector("#result-count").textContent === "1 architecture cards shown");
  const filtered = await architectureState();
  assert.equal(filtered.resultCount, "1 architecture cards shown");
  assert.equal(filtered.cards.filter((card) => !card.searchHidden).length, 1);
  assert.equal(filtered.cards.find((card) => !card.searchHidden)?.title, "Filter builder");
  assert.equal(filtered.cards.filter((card) => card.searchHidden).length, filtered.cards.length - 1, "Non-matching cards must use is-search-hidden");
  assert.equal(filtered.layers.filter((layer) => layer.visibleCards === 0).length, 4);
  assert.ok(filtered.layers.filter((layer) => layer.visibleCards === 0).every((layer) => layer.dimmed && layer.hidden), "Search-empty layers must be dimmed and hidden");

  await page.evaluate(() => document.querySelector(".architecture-card:not(.is-search-hidden)").click());
  await page.waitFor(() => document.querySelector("#inspector-body h3")?.textContent?.trim() === "Filter builder");
  const filterInspector = await architectureState();
  assert.equal(filterInspector.inspectorText.includes("lv_filterStatus"), true, "Filter builder inspection must expose lv_filterStatus");
  assert.match(filterInspector.inspectorText, /coverage/i, "The inspector must expose coverage after selection");
  assert.match(filterInspector.inspectorText, /evidence source/i, "The inspector must expose the evidence source after selection");

  await page.evaluate(() => document.querySelector("#clear-search").click());
  await page.waitFor(() => document.querySelector("#result-count").textContent === "6 architecture cards shown");
  const afterClear = await architectureState();
  assert.equal(afterClear.resultCount, "6 architecture cards shown");
  assert.equal(afterClear.search, "");
  assert.equal(afterClear.tabs.find((tab) => tab.id === "surface")?.ariaPressed, "true");

  await clickLayerJump("shell");
  await page.waitFor(() => document.querySelector('[data-layer-tab="shell"]').getAttribute("aria-pressed") === "true");
  const shell = await architectureState();
  assert.equal(shell.tabs.filter((tab) => tab.ariaPressed === "true").length, 1);
  assert.equal(shell.tabs.find((tab) => tab.id === "shell")?.ariaPressed, "true");
  assert.equal(shell.selectedVisibleCards.length, 1, "Layer jumps must select a visible card");
  assert.equal(shell.selectedVisibleCards[0].layerId, "shell", "Layer jumps must select a card in the target layer");
  assert.equal(shell.layers.find((layer) => layer.id === "shell")?.dimmed, false);
  assert.equal(shell.layers.find((layer) => layer.id === "shell")?.hidden, false);
  assert.equal(shell.layers.find((layer) => layer.id === "shell")?.visibleCards > 0, true);
  assert.equal(await page.evaluate(() => document.querySelector('[data-layer-id="shell"]').classList.contains("is-highlighted")), true, "The jumped-to layer must be highlighted");

  await setSearch("no architecture card matches this");
  await page.waitFor(() => document.querySelector("#result-count").textContent === "0 architecture cards shown");
  const noMatches = await architectureState();
  assert.equal(noMatches.cards.filter((card) => !card.searchHidden).length, 0);
  assert.equal(noMatches.inspectorText, "", "No matches must clear the inspector");
  assert.equal(noMatches.selectedVisibleCards.length, 0);
  assert.ok(noMatches.layers.every((layer) => layer.visibleCards === 0 && layer.dimmed && layer.hidden), "No matches must hide and dim every empty layer");

  await page.evaluate(() => document.querySelector("#clear-search").click());
  await page.waitFor(() => document.querySelector("#architecture-search").value === "" && document.querySelector('[data-layer-tab="shell"]').getAttribute("aria-pressed") === "true");
  const afterReset = await architectureState();
  assert.equal(afterReset.search, "", "Clear search must clear the search text");
  assert.equal(afterReset.tabs.find((tab) => tab.id === "shell")?.ariaPressed, "true", "Clear search must preserve the active layer");
  assert.equal(afterReset.cards.filter((card) => !card.searchHidden).every((card) => card.layerId === "shell"), true, "Clear search must not reset the active layer");
  assert.equal(afterReset.resultCount, `${afterReset.cards.filter((card) => !card.searchHidden).length} architecture cards shown`);

  await page.evaluate(() => document.querySelector('[data-layer-tab="all"]').click());
  await page.waitFor(() => document.querySelector('[data-layer-tab="all"]').getAttribute("aria-pressed") === "true" && document.querySelector("#result-count").textContent.endsWith(" architecture cards shown"));
  const allLayers = await architectureState();
  assert.equal(allLayers.resultCount, `${initial.cards.length} architecture cards shown`, "The all-layers tab must show every architecture card");
  assert.equal(allLayers.cards.filter((card) => !card.searchHidden).length, initial.cards.length);
  assert.equal(allLayers.cards.filter((card) => card.searchHidden).length, 0);
  assert.ok(allLayers.layers.every((layer) => !layer.dimmed && !layer.hidden), "The all-layers tab must show every layer");

  stopArchitectureRequestCapture();
  assertLocalRequests("The standalone architecture page");

  await page.send("Page.navigate", { url: `${localOrigin}/` });
  await page.waitFor(() => Boolean(document.querySelector(".app-shell")));
  await page.evaluate(() => {
    const leadsButton = [...document.querySelectorAll("button.nav-item")].find((button) => [...button.querySelectorAll("span")].some((span) => span.textContent?.trim() === "Leads"));
    if (!(leadsButton instanceof HTMLButtonElement)) throw new Error("The React CRM Leads navigation button is missing");
    leadsButton.click();
  });
  await page.waitFor(() => Boolean(document.querySelector(".app-shell")) && document.querySelector("h1")?.textContent?.trim() === "Leads");
  const crmState = await page.evaluate(() => ({
    graphButtons: [...document.querySelectorAll("button")].filter((button) => /\bgraph\b/i.test(`${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`)).length,
    graphPanels: [...document.querySelectorAll("[id], [class], [data-view]")].filter((node) => !["BUTTON", "HTML", "BODY"].includes(node.tagName) && /\bgraph\b/i.test(`${node.id} ${typeof node.className === "string" ? node.className : ""} ${node.getAttribute("data-view") ?? ""}`)).length,
  }));
  assert.equal(crmState.graphButtons, 0, "The local React CRM Leads page must not expose a graph button");
  assert.equal(crmState.graphPanels, 0, "The local React CRM Leads page must not expose a graph panel");

  await navigateToArchitecture();
  await page.waitFor(() => document.querySelector("#architecture-search")?.value === "" && document.querySelector('[data-layer-tab="all"]').getAttribute("aria-pressed") === "true");
  stopArchitectureRequestCapture();
  assertLocalRequests("The restored standalone architecture page");
  architectureRestored = true;
  assert.deepEqual(errors, [], "The browser pages must not raise runtime exceptions");
  console.log(JSON.stringify({
    cards: initial.cards.length,
    layers: initial.layers.length,
    surfaceCards: 6,
    search: "filter",
    selected: "Filter builder",
    layerJump: "shell",
    noMatchesInspectorCleared: true,
    crmLeadsChecked: true,
    localArchitectureRequests: architectureRequests.length,
    runtimeErrors: errors.length,
  }, null, 2));
} finally {
  if (!architectureRestored) {
    try {
      await navigateToArchitecture();
      stopArchitectureRequestCapture();
    } catch {
      // Preserve the original smoke-test failure while still closing the CDP session.
    }
  }
  page.close();
}
