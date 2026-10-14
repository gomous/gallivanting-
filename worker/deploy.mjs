/**
 * Deploys the Gallivanter API worker to Cloudflare.
 *
 * Set environment variables before running:
 *   CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
 *   CLOUDFLARE_ACCOUNT_ID=your-account-id
 *   CF_SUBDOMAIN=your-subdomain (e.g., jolly-rain-7712)
 *
 * Usage: node deploy.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import https from "node:https";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const WORKER_NAME = "gallivanter-api";
const CF_SUBDOMAIN = process.env.CF_SUBDOMAIN || "";

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("❌ Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.");
  process.exit(1);
}

// Step 1: Bundle with esbuild as ESM
const entry = resolve("src/index.ts");
const outfile = resolve("dist/index.js");

try {
  execFileSync(
    "node",
    [resolve("../node_modules/esbuild/bin/esbuild"), entry, `--outfile=${outfile}`, "--bundle", "--format=esm", "--platform=browser"],
    { stdio: "inherit" }
  );
  console.log("✅ Bundled successfully");
} catch (e) {
  console.error("❌ Bundle failed:", e.message);
  process.exit(1);
}

// Step 2: Read bundled code
const scriptContent = readFileSync(outfile, "utf-8");

// Step 3: Deploy via Cloudflare API using the module worker endpoint
const boundary = "----CloudflareBoundary" + Date.now();
const delimiter = `\r\n--${boundary}\r\n`;
const closeDelim = `\r\n--${boundary}--\r\n`;

const metadata = {
  main_module: "worker.mjs",
};

const body =
  delimiter +
  'Content-Disposition: form-data; name="metadata"\r\n' +
  "Content-Type: application/json\r\n\r\n" +
  JSON.stringify(metadata) +
  delimiter +
  'Content-Disposition: form-data; name="worker.mjs"; filename="worker.mjs"\r\n' +
  "Content-Type: application/javascript+module\r\n\r\n" +
  scriptContent +
  closeDelim;

const options = {
  hostname: "api.cloudflare.com",
  path: `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`,
  method: "PUT",
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": Buffer.byteLength(body),
  },
};

console.log("Deploying to Cloudflare...");

const req = https.request(options, (res) => {
  let responseBody = "";
  res.on("data", (chunk) => (responseBody += chunk));
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    try {
      const result = JSON.parse(responseBody);
      console.log(JSON.stringify(result, null, 2));
      if (result.success) {
        console.log("\n✅ Worker deployed successfully!");
        console.log(`URL: https://${CF_SUBDOMAIN}.${ACCOUNT_ID}.workers.dev`);
      } else {
        console.error("\n❌ Deployment failed!");
        process.exit(1);
      }
    } catch {
      console.log("Response:", responseBody);
    }
  });
});

req.on("error", (e) => {
  console.error("❌ Request failed:", e.message);
  process.exit(1);
});

req.write(body);
req.end();
