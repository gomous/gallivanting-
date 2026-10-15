/**
 * Upload built site to Cloudflare R2 bucket and serve via Workers.
 *
 * This is a fallback approach when GitHub Actions can't be used.
 * Uses the R2 S3-compatible API.
 *
 * Usage:
 *   CLOUDFLARE_R2_ACCOUNT_ID=your-account-id
 *   CLOUDFLARE_R2_ACCESS_KEY_ID=your-access-key
 *   CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-secret-key
 *   CLOUDFLARE_R2_BUCKET=gallivanter-site
 *   node deploy-via-r2.mjs
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fromEnv } from "@aws-sdk/credential-providers";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID || "";
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET = process.env.R2_BUCKET || "gallivanter-site";

console.log("Building project...");
try {
  execSync("npx vite build", { stdio: "inherit" });
  console.log("✅ Build complete\n");
} catch {
  console.error("❌ Build failed");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

const distDir = resolve("dist");
function collectFiles(dir, prefix = "") {
  let results = [];
  const entries = readdirSync(dir, { withFile dirents: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name === "renderer" || entry.name === "main" || entry.name === "preload") continue;
    if (entry.isDirectory()) {
      results = results.concat(collectFiles(fullPath, relPath));
    } else {
      results.push({ key: relPath, path: fullPath });
    }
  }
  return results;
}

const files = collectFiles(distDir);
console.log(`Uploading ${files.length} files to R2 bucket: ${BUCKET}`);

let uploaded = 0;
for (const file of files) {
  try {
    const content = readFileSync(file.path);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: file.key,
      Body: content,
      ContentType: file.key.endsWith(".css") ? "text/css" :
                 file.key.endsWith(".html") ? "text/html" :
                 file.key.endsWith(".js") ? "application/javascript" :
                 file.key.endsWith(".json") ? "application/json" : "application/octet-stream",
      CacheControl: file.key.endsWith(".html") ? "no-cache" : "public, max-age=31536000",
    }));
    uploaded++;
    process.stdout.write(`\r${uploaded}/${files.length} files uploaded`);
  } catch (e) {
    console.error(`\n❌ Failed to upload ${file.key}:`, e.message);
  }
}

console.log(`\n✅ Uploaded ${uploaded}/${files.length} files to R2`);
