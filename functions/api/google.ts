/**
 * Google OAuth flow start.
 * Route: /api/google
 * Query params: client_id, client_secret
 */
import {
  corsHeaders,
  DEFAULT_REDIRECT_URI,
  SESSION_COOKIE,
  serializeCookie,
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

export const onRequestGet: ExportedHandler<{}> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const clientId = url.searchParams.get("client_id") || "";
  const clientSecret = url.searchParams.get("client_secret") || "";

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "Missing client_id or client_secret" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const state = crypto.randomUUID();
  const authUrl = buildAuthUrl(clientId, DEFAULT_REDIRECT_URI, state);

  const cookie = serializeCookie(`${SESSION_COOKIE}_creds`, btoa(JSON.stringify({ clientId, clientSecret })), 300);
  const stateCookie = serializeCookie(`${SESSION_COOKIE}_state`, state, 300);

  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: authUrl, "Set-Cookie": `${cookie}, ${stateCookie}` },
  });
};

export const onRequestOptions: ExportedHandler<{}> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};
