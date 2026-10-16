/**
 * Every /api/* request on gallivanter.pages.dev is handled by the shared
 * Gallivanter backend (server/src): auth, CRM tools, original-UI sync, AI.
 */
import { app } from "../../server/src/index.ts";

interface PagesContext {
  request: Request;
  env: Record<string, unknown>;
  waitUntil: (p: Promise<unknown>) => void;
  passThroughOnException: () => void;
}

export const onRequest = (ctx: PagesContext): Response | Promise<Response> =>
  app.fetch(ctx.request, ctx.env, { waitUntil: ctx.waitUntil, passThroughOnException: ctx.passThroughOnException, props: {} } as unknown as ExecutionContext);
