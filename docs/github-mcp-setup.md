# GitHub MCP setup

Gallivanting's project-local OpenCode configuration uses GitHub's official hosted MCP server, which is built from the [`github/github-mcp-server`](https://github.com/github/github-mcp-server) project.

## Current configuration

`opencode.json` registers a server named `github` with:

- Official remote endpoint: `https://api.githubcopilot.com/mcp/x/all`
- PAT authentication through the `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable
- All GitHub MCP toolsets enabled

The server can expose read and write GitHub operations. Actual access is still bounded by the permissions granted to the GitHub token.

## Authenticate in PowerShell

Create a GitHub Personal Access Token with the permissions needed for the work. Do not paste it into chat, commit it, or put it in `opencode.json`.

For the current PowerShell session, enter it without echoing it to the terminal or saving it in command history:

```powershell
$securePat = Read-Host "GitHub PAT" -AsSecureString
$env:GITHUB_PERSONAL_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $securePat).Password
```

This places the token only in the current process environment. A protected local secret manager can also populate the variable before OpenCode starts. For example, if the token is already available through an approved secret environment variable:

```powershell
$env:GITHUB_PERSONAL_ACCESS_TOKEN = $env:YOUR_APPROVED_GITHUB_SECRET
```

Then start standalone OpenCode from the project directory:

```powershell
opencode mcp list
opencode mcp debug github
opencode
```

The server should report `connected`. Verify with a harmless request such as listing the current user or reading this repository's status.

## Project launcher

The repository includes a launcher that resolves the global Windows OpenCode installation even when `opencode` is missing from the current PowerShell `PATH`:

```powershell
Set-Location -LiteralPath (git rev-parse --show-toplevel)
.\scripts\start-mcp-opencode.ps1
```

If the PAT is already set, the launcher reuses it. Otherwise it asks for the PAT with hidden input and keeps it only in the launched process environment. Pass normal OpenCode arguments after the script when needed, for example:

```powershell
.\scripts\start-mcp-opencode.ps1 run "Use only the github MCP server to inspect gomous/gallivanting-."
```

## Important security notes

- Never commit a PAT or place it in a tracked file.
- A token stored in an environment variable is available to processes launched from that PowerShell session; close the session when finished.
- This project configuration exposes write-capable GitHub tools. I will still ask before destructive or externally visible actions such as deleting repositories, merging pull requests, publishing releases, or changing deployment configuration.
- The MCP server's write tools operate through GitHub's API. Local `git commit` and `git push` also require Git's own HTTPS/SSH credential configuration; the MCP token is not automatically installed as a Git credential.
- The managed `omnirush` session disables MCP. Use `scripts/start-mcp-opencode.ps1` or standalone OpenCode from this directory for direct MCP calls.

## Local-server alternative

The upstream project also supports a Docker-hosted local server with browser OAuth. Docker is installed on this machine, but the Docker Desktop Linux daemon is currently not running. Start Docker Desktop before switching to the local configuration described in the upstream installation guide.
