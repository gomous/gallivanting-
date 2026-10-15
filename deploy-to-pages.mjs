/**
 * Deploy to Cloudflare Pages via direct upload API.
 *
 * Usage:
 *   node deploy-to-pages.mjs
 *
 * Uses env vars:
 *   CLOUDFLARE_API_TOKEN (R2-scoped token)
 *   CLOUDFLARE_ACCOUNT_ID
 *
 * Note: R2-scoped tokens can upload to Pages but cannot manage routes.
 * This uses the direct upload endpoint for Pages deployments.
 */
import https from "node:https";
import { createReadStream, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import FormData from "form-data";

const ACCT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const PROJECT_NAME = "gallivanter";

if (!ACCT_ID || !API_TOKEN) {
  console.error("❌ Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars.");
  process.exit(1);
}

// Step 1: Build the project
console.log("Building project...");
try {
  execSync("npx vite build", { stdio: "inherit" });
  console.log("✅ Build complete\n");
} catch {
  console.error("❌ Build failed");
  process.exit(1);
}

// Step 2: Create a form with all files for upload
const form = new FormData();
const distDir = resolve("dist");

function addFiles(dir, prefix = "") {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name === "renderer" || entry.name === "main" || entry.name === "preload") continue;
    if (entry.isDirectory()) {
      addFiles(fullPath, relPath);
    } else {
      form.append("file", createReadStream(fullPath), {
        filename: relPath,
        contentType: "application/octet-stream",
      });
    }
  }
}

addFiles(distDir);

// Add public files
const publicDir = resolve("public");
const extraFiles = ["_redirects", "_headers", "sw.js", "manifest.json"];
for (const f of extraFiles) {
  try {
    form.append("file", createReadStream(join(publicDir, f)), {
      filename: f,
      contentType: "application/octet-stream",
    });
  } catch {
    // skip
  }
}

const boundary = form.getBoundary();

const options = {
  hostname: "api.cloudflare.com",
  path: `/client/v4/accounts/${ACCT_ID}/pages/projects/${PROJECT_NAME}/deployments`,
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  },
};

console.log("Uploading deployment to Cloudflare Pages...");

const req = https.request(options, (res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    try {
      const result = JSON.parse(body);
      if (result.success) {
        console.log("\n✅ Deployment created!");
        console.log("Deployment ID:", result.result?.id);
        console.log("URL:", result.result?.url);
      } else {
        console.error("\n❌ Deployment failed!");
        console.error(JSON.stringify(result, null, 2));
      }
    } catch {
      console.log("Response:", body);
    }
  });
});

req.on("error", (e) => {
  console.error("❌ Request failed:", e.message);
  process.exit(1);
});

form.pipe(req);
