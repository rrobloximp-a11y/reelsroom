import type { Config, Context } from "@netlify/functions";
import { channelImageKey, mediaStore } from "../lib/shared.js";

// Serves channel icons and banners. URLs carry ?v=<version>, so new uploads bypass old caches.
export default async (_req: Request, context: Context) => {
  const { id, kind } = context.params;
  if (kind !== "avatar" && kind !== "banner") return new Response("Not found", { status: 404 });
  const data = await mediaStore().get(channelImageKey(id, kind), { type: "arrayBuffer" });
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(data, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
};

export const config: Config = {
  path: "/channel-media/:id/:kind",
};
