# Gallivanter application MCP boundary

This note records the boundary for the future Gallivanter MCP server. It is a planning document only; it does not expose the application to an AI client yet.

## Product surfaces

- `public/gallivanter.html` is a presentation and access-request page only.
- The operational workspace remains the installed Electron application and the future mobile PWA.
- The marketing page must never gain direct access to CRM storage, records, Electron IPC, or operational tools.

## Proposed MCP layers

The application MCP should be a separate adapter around explicit application services, not a bridge to the React DOM:

1. **MCP transport** — the server connection and authentication boundary chosen after reviewing Claude's integration requirements.
2. **Gallivanter tool adapter** — small, typed tools that call application services rather than clicking UI controls.
3. **Application services** — the same validated domain operations used by the desktop and PWA surfaces.
4. **Persistence and audit** — existing local backend rules, with every mutating tool producing an audit event.

## Initial tool families to evaluate with Claude

Start read-only and add mutation only after the request/confirmation contract is clear:

- Search contacts, leads, opportunities, tasks, and activity.
- Read a complete record with its related context.
- List overdue and upcoming follow-ups.
- Draft a note or next-step recommendation without saving it.
- Create or update a task only with explicit confirmation.
- Record an activity only with explicit confirmation and an audit entry.

Every tool should have a stable name, versioned input schema, validated output schema, and an explicit authority level such as `read`, `draft`, or `mutate`.

## Safety requirements

- Never expose raw storage, arbitrary JavaScript execution, Electron IPC, or filesystem access as an MCP tool.
- Use organization and workspace scope on every record operation.
- Treat identifiers as opaque; do not let a model construct SQL-like or storage-key queries.
- Keep credentials outside the repository and outside tool results.
- Require confirmation for create, update, delete, send, or sync operations.
- Return structured errors and validation failures rather than silently coercing input.
- Preserve audit events for every successful mutation.
- Keep the marketing site and its signup form completely outside this trust boundary.

## Integration sequence

1. Follow Claude's current MCP transport and authentication requirements.
2. Define a versioned tool manifest and JSON schemas.
3. Implement read-only tools against application services.
4. Add contract tests for scope, validation, redaction, and audit behavior.
5. Connect an isolated Claude test client and verify read-only behavior.
6. Add confirmed mutations one tool family at a time.

The first implementation decision should be made from the integration instructions supplied by Claude, not guessed from the landing page or from UI behavior.
