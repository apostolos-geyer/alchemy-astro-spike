import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

// The adapter declares an IMAGES binding in its wrangler.json. Alchemy does
// not read that file, so this proves whether the binding is actually present
// on the deployed Worker.
export const GET: APIRoute = async () => {
  const images = (env as any).IMAGES;
  return new Response(
    JSON.stringify({
      present: images !== undefined,
      type: typeof images,
      hasInput: typeof images?.input === "function",
    }),
    { headers: { "content-type": "application/json" } },
  );
};
