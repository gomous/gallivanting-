/**
 * Check authentication status.
 * Route: /api/auth/status
 */
import { corsHeaders, getSessionToken } from "../_lib";

export const onRequestGet: ExportedHandler = async (ctx) => {
  const token = getSessionToken(ctx.request);
  return new Response(JSON.stringify({ authenticated: !!token }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

export const onRequestOptions: ExportedHandler = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};
