/** Cloudflare Pages Functions types */

interface PagesFunctionContext {
  request: Request;
  env: Record<string, unknown>;
  params: Record<string, string>;
  next: () => Promise<Response>;
}

declare type ExportedHandler<Env = Record<string, unknown>, Params extends Record<string, string> = Record<string, string>> = {
  (ctx: { request: Request; env: Env; params: Params; next: () => Promise<Response> }): Response | Promise<Response>;
};
