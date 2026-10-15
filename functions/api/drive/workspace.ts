/**
 * Google Drive workspace read/write.
 * Route: /api/drive/workspace (GET reads, POST writes)
 * Uses server-side credentials for token refresh.
 */
import {
  corsHeaders,
  DEFAULT_FILE_NAME,
  getSessionToken,
  getValidToken,
  findWorkspaceFile,
  readWorkspace,
  writeWorkspace,
  serializeCookie,
  SESSION_COOKIE,
  DriveSession,
} from "../_lib";

export const onRequestGet: ExportedHandler<Env> = async (ctx) => {
  const env = ctx.env as Record<string, unknown>;
  const token = getSessionToken(ctx.request);
  if (!token) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const valid = await getValidToken(env, token);
    const fileId = await findWorkspaceFile(valid.access_token, DEFAULT_FILE_NAME);

    if (!fileId) {
      return new Response(JSON.stringify({ workspace: "", updatedAt: "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await readWorkspace(valid.access_token, fileId);

    // Update session if token was refreshed
    const headers: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
    if (valid.expires_at !== token.expires_at || valid.access_token !== token.access_token) {
      headers["Set-Cookie"] = serializeCookie(SESSION_COOKIE, JSON.stringify(valid), 60 * 60 * 24 * 30);
    }

    return new Response(JSON.stringify({ workspace: raw, updatedAt: new Date().toISOString() }), { headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Drive read failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

export const onRequestPost: ExportedHandler<Env> = async (ctx) => {
  const env = ctx.env as Record<string, unknown>;
  const token = getSessionToken(ctx.request);
  if (!token) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await ctx.request.json()) as { workspace: string; existingFileId?: string | null };
    if (!body.workspace) {
      return new Response(JSON.stringify({ error: "Missing workspace" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const valid = await getValidToken(env, token);
    const fileId = await writeWorkspace(valid.access_token, body.workspace, valid.existingFileId ?? null, DEFAULT_FILE_NAME);

    // Update session with fileId and any refreshed token data
    const updatedToken: DriveSession = { ...valid, existingFileId: fileId };
    const sessionCookie = serializeCookie(SESSION_COOKIE, JSON.stringify(updatedToken), 60 * 60 * 24 * 30);

    return new Response(JSON.stringify({ fileId, updatedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Set-Cookie": sessionCookie },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Drive write failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

export const onRequestOptions: ExportedHandler = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};
