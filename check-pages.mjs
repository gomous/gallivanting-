import https from "node:https";

const ACCT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCT_ID || !API_TOKEN) {
  console.error("❌ Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars.");
  process.exit(1);
}

// Check what we can do with the token
const options = {
  hostname: "api.cloudflare.com",
  path: `/client/v4/accounts/${ACCT_ID}/pages/projects/gallivanter`,
  method: "GET",
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
  },
};

const req = https.request(options, (res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    try {
      const result = JSON.parse(body);
      console.log("Project name:", result.result?.name);
      console.log("Subdomain:", result.result?.subdomain);
      console.log("Domains:", result.result?.domains);
      console.log("Created:", result.result?.created_on);
    } catch {
      console.log("Response:", body);
    }
  });
});

req.on("error", (e) => console.error("Error:", e.message));
req.end();
