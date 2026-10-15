/**
 * Google OAuth callback.
 * Route: /api/google/callback
 * Query params: code, state
 */
import {
  corsHeaders,
  DEFAULT_REDIRECT_URI,
  SESSION_COOKIE,
  exchangeCode,
  parseCookies,
  serializeCookie,
} from "../_lib";

export const onRequestGet: ExportedHandler<{}> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(ctx.request.headers.get("Cookie"));
  const storedState = cookies[`${SESSION_COOKIE}_state`];
  const storedCreds = cookies[`${SESSION_COOKIE}_creds`];

  if (!code || !state || state !== storedState || !storedCreds) {
    return new Response("Invalid OAuth callback", { status: 400 });
  }

  let creds: { clientId: string; clientSecret: string };
  try {
    creds = JSON.parse(atob(storedCreds));
  } catch {
    return new Response("Invalid credentials", { status: 400 });
  }

  try {
    const token = await exchangeCode(creds.clientId, creds.clientSecret, code, DEFAULT_REDIRECT_URI);
    const sessionCookie = serializeCookie(SESSION_COOKIE, JSON.stringify(token), 60 * 60 * 24 * 30);
    const clearCookies = [
      serializeCookie(`${SESSION_COOKIE}_state`, "", 0),
      serializeCookie(`${SESSION_COOKIE}_creds`, "", 0),
    ].join(", ");

    // Redirect to the app with success indicator
    const redirectUrl = `https://gallivanter.pages.dev/?auth=success`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: redirectUrl,
        "Set-Cookie": `${sessionCookie}, ${clearCookies}`,
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

export const onRequestOptions: ExportedHandler<{}> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};
