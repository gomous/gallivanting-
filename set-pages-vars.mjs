/**
 * Set Google OAuth environment variables for the Pages project.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=your-client-id \
 *   GOOGLE_CLIENT_SECRET=your-client-secret \
 *   CF_ACCOUNT_ID=your-account-id \
 *   CF_API_TOKEN=your-api-token \
 *   node set-pages-vars.mjs
 */
import https from "node:https";

const ACCT_ID = process.env.CF_ACCOUNT_ID || "";
const API_TOKEN = process.env.CF_API_TOKEN || "";
const PROJECT_NAME = "gallivanter";

if (!ACCT_ID || !API_TOKEN) {
  console.error("❌ Set CF_API_TOKEN and CF_ACCOUNT_ID env vars.");
  process.exit(1);
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("❌ Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.");
  process.exit(1);
}

async function setVar(name, value) {
  const data = JSON.stringify({
    "deployment_configs": {
      "production": {
        "env_vars": {
          [name]: { "value": value, "type": "secret_text" }
        }
      },
      "preview": {
        "env_vars": {
          [name]: { "value": value, "type": "secret_text" }
        }
      }
    }
  });

  return new Promise((resolve) => {
    const options = {
      hostname: "api.cloudflare.com",
      path: `/client/v4/accounts/${ACCT_ID}/pages/projects/${PROJECT_NAME}`,
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const result = JSON.parse(body);
          console.log(`Setting ${name}: ${result.success ? "✅ success" : "❌ failed"}`);
          if (!result.success) console.log(JSON.stringify(result.errors));
        } catch {
          console.log(`Setting ${name}: Response: ${body}`);
        }
        resolve();
      });
    });

    req.on("error", (e) => {
      console.error(`❌ Request failed for ${name}:`, e.message);
      resolve();
    });
    req.write(data);
    req.end();
  });
}

async function main() {
  await setVar("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID);
  await setVar("GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET);
  console.log("\n✅ Environment variables set!");
  console.log("Trigger a new deployment to apply: git commit --allow-empty -m 'redeploy' && git push");
}

main();
