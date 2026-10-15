/**
 * Google OAuth flow start.
 * Route: /api/google
 * Uses server-side credentials from environment variables.
 */
import {
  corsHeaders,
  SESSION_COOKIE,
  serializeCookie,
  getRedirectUri,
} from "./_lib";

function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export const onRequestGet: ExportedHandler<Env> = async (ctx) => {
  const env = ctx.env as Record<string, unknown>;
  const clientId = env.GOOGLE_CLIENT_ID as string || "";

  if (!clientId) {
    return new Response(JSON.stringify({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID in Pages environment variables." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const redirectUri = getRedirectUri(ctx.request);
  const state = crypto.randomUUID();
  const authUrl = buildAuthUrl(clientId, redirectUri, state);

  const stateCookie = serializeCookie(`${SESSION_COOKIE}_state`, state, 300);

  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: authUrl, "Set-Cookie": stateCookie },
  });
};

export const onRequestOptions: ExportedHandler = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};
