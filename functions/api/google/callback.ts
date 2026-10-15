/**
 * Google OAuth callback.
 * Route: /api/google/callback
 * Query params: code, state
 * Uses server-side credentials from environment variables.
 */
import {
  corsHeaders,
  SESSION_COOKIE,
  exchangeCode,
  parseCookies,
  serializeCookie,
  getRedirectUri,
} from "../_lib";

export const onRequestGet: ExportedHandler<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(ctx.request.headers.get("Cookie"));
  const storedState = cookies[`${SESSION_COOKIE}_state`];

  if (!code || !state || state !== storedState) {
    return new Response("Invalid OAuth callback", { status: 400 });
  }

  const env = ctx.env as Record<string, unknown>;
  const redirectUri = getRedirectUri(ctx.request);

  try {
    const session = await exchangeCode(env, code, redirectUri);
    const sessionCookie = serializeCookie(SESSION_COOKIE, JSON.stringify(session), 60 * 60 * 24 * 30);
    const clearCookie = serializeCookie(`${SESSION_COOKIE}_state`, "", 0);

    // Redirect to the app with success indicator
    const hostname = url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? `${url.origin}`
      : `https://${url.hostname}`;
    const redirectUrl = `${hostname}/?auth=success`;

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: redirectUrl,
        "Set-Cookie": [sessionCookie, clearCookie],
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token exchange failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

export const onRequestOptions: ExportedHandler = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};
