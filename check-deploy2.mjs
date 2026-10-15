import https from "node:https";

https.get("https://gallivanter.pages.dev/assets/index-CCjOarHT.js", (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    const checks = [
      ["landing-page", data.includes("landing-page")],
      ["landing-card", data.includes("landing-card")],
      ["Connect to Google Drive", data.includes("Connect to Google Drive")],
    ];
    checks.forEach(([name, found]) => console.log(`${found ? "✅" : "❌"} ${name}`));
  });
}).on("error", (e) => console.error("Error:", e.message));
