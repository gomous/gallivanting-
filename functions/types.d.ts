/** Cloudflare Pages Functions types */

interface Env {
  [key: string]: unknown;
}

interface PagesFunctionContext {
  request: Request;
  env: Env;
  params: Record<string, string>;
  next: () => Promise<Response>;
}

declare type ExportedHandler<Env = Record<string, unknown>, Params extends Record<string, string> = Record<string, string>> = {
  (ctx: { request: Request; env: Env; params: Params; next: () => Promise<Response> }): Response | Promise<Response>;
};
