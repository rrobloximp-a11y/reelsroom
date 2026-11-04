import type { Config, Context } from "@netlify/functions";
import { postImageKey, mediaStore } from "../lib/shared.js";

// Serves images attached to community posts. Post images never change, so they cache well.
export default async (_req: Request, context: Context) => {
  const data = await mediaStore().get(postImageKey(context.params.id), { type: "arrayBuffer" });
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(data, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
};

export const config: Config = {
  path: "/post-media/:id",
};
