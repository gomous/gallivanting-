import asyncio, json, os, time
from pathlib import Path

from playwright.async_api import async_playwright

URL = "http://127.0.0.1:5173/"
OUT = Path(os.environ.get("GALLIVANTING_OUT", "tmp_screenshots"))
OUT.mkdir(parents=True, exist_ok=True)

VIEWPORTS = {
    "mobile": {"width": 390, "height": 844, "device_scale_factor": 2, "is_mobile": True},
    "tablet":  {"width": 1024, "height": 1366, "device_scale_factor": 2, "is_mobile": False},
    "desktop": {"width": 1440, "height": 900, "device_scale_factor": 1, "is_mobile": False},
}


async def main():
    async with async_playwright() as p:
        # Prefer system Chrome if available; fall back to puppeteer cache chrome.
        chrome_paths = [
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            str(Path(os.environ["USERPROFILE"]) / ".cache/puppeteer/chrome/win64-150.0.7871.24/chrome-win64/chrome.exe"),
        ]
        executable = next((c for c in chrome_paths if Path(c).exists()), None)
        if not executable:
            executable = p.chromium.executable_path
        for name, vp in VIEWPORTS.items():
            browser = await p.chromium.launch(
                headless=True,
                args=[f"--window-size={vp['width']},{vp['height']}"],
                executable_path=executable,
            )
            context = await browser.new_context(
                viewport={"width": vp["width"], "height": vp["height"]},
                device_scale_factor=vp["device_scale_factor"],
                is_mobile=vp["is_mobile"],
            )
            page = await context.new_page()
            await page.goto(URL, wait_until="networkidle", timeout=45000)
            await page.screenshot(path=str(OUT / f"view-{name}.png"), full_page=True)
            # Save a compact viewport-sized shot of just the viewport for quick reading
            await page.screenshot(path=str(OUT / f"view-{name}-vp.png"))
            await browser.close()
            print(f"captured {name}")


asyncio.run(main())
