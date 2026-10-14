import base64
import json
import sys
from pathlib import Path

from nacl import encoding, public

OWNER = "gomous"
REPO = "gallivanting-"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"

# Secrets are passed via a local JSON file (not committed) to keep them out of logs.
config = json.loads(Path("secrets_payload.json").read_text(encoding="utf-8"))
token = config["github_token"]
secrets = config["secrets"]

headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gallivanting-ci-setup",
}


def api(method: str, url: str, payload: dict | None = None) -> dict:
    import urllib.request

    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        raise SystemExit(f"{method} {url} -> HTTP {exc.code}: {body}") from exc


# 1. Fetch the repo's Actions public key
pk = api("GET", f"{API}/actions/secrets/public-key")
recipient = public.PublicKey(pk["key"].encode(), encoding.Base64Encoder())
sealed = public.SealedBox(recipient)

# 2. Encrypt + PUT each secret
for name, raw in secrets.items():
    encrypted = sealed.encrypt(raw.encode())
    api(
        "PUT",
        f"{API}/actions/secrets/{name}",
        {
            "encrypted_value": base64.b64encode(encrypted).decode(),
            "key_id": pk["key_id"],
        },
    )
    print(f"set secret: {name}")

# 3. Verify
listed = api("GET", f"{API}/actions/secrets")
names = [s["name"] for s in listed.get("secrets", [])]
print("repo secrets now:", names)
