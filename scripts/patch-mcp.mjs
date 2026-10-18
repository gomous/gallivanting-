import fs from "node:fs";

const indexPath = new URL("../server/src/index.ts", import.meta.url).pathname;
let c = fs.readFileSync(indexPath, "utf8");

// 1. Ensure the import is present.
const imp = `import { handleMcp } from "./mcp.ts";`;
if (!c.includes(imp)) {
  const anchor = `import { apiKeys, chat, listModels, type AiEnv, type ChatMessage } from "./ai.ts";`;
  c = c.replace(anchor, `${anchor}\n${imp}`);
}

// 2. Ensure MCP routes are registered before the SPA catch-all.
const apiCatch = `app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Unknown API route" } }, 404));`;
const routes = `${apiCatch}\n\n// ---------- MCP (Claude connector) ----------\napp.all("/mcp", (c) => handleMcp(c as never));\napp.all("/mcp/*", (c) => handleMcp(c as never));`;
if (!c.includes(`app.all("/mcp"`)) {
  if (!c.includes(apiCatch)) throw new Error("Could not find API catch-all anchor");
  c = c.replace(apiCatch, routes);
}

fs.writeFileSync(indexPath, c);
console.log("patched index.ts:",
  "import=" + c.includes(imp),
  "routes=" + c.includes(`app.all("/mcp"`),
);