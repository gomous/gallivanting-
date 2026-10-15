/**
 * Logout from Google Drive.
 * Route: /api/auth/logout (POST)
 */
import { corsHeaders, SESSION_COOKIE, serializeCookie } from "../_lib";

export const onRequestPost: ExportedHandler<{}> = async (ctx) => {
  const clearCookie = serializeCookie(SESSION_COOKIE, "", 0);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Set-Cookie": clearCookie },
  });
};

export const onRequestOptions: ExportedHandler<{}> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};
