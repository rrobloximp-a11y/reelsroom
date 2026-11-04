import { admin } from "./supabase.js";

const bucket = () => admin.storage.from("media");

async function download(key: string) {
  const { data, error } = await bucket().download(key);
  if (error) {
    if (/not found/i.test(error.message)) return null;
    throw error;
  }
  return data;
}

// Storage has no recursive listing, so walk folders until only files remain.
async function listKeys(folder: string): Promise<string[]> {
  const { data, error } = await bucket().list(folder, { limit: 1000 });
  if (error) throw error;
  const nested = await Promise.all(
    data.map((entry) => (entry.id === null ? listKeys(`${folder}/${entry.name}`) : Promise.resolve([`${folder}/${entry.name}`]))),
  );
  return nested.flat();
}

export const mediaStore = () => ({
  async getBuffer(key: string): Promise<ArrayBuffer | null> {
    const data = await download(key);
    return data ? data.arrayBuffer() : null;
  },
  async getText(key: string): Promise<string | null> {
    const data = await download(key);
    return data ? data.text() : null;
  },
  async set(key: string, value: ArrayBuffer | string): Promise<void> {
    const blob = new Blob([value], { type: typeof value === "string" ? "text/plain" : "application/octet-stream" });
    const { error } = await bucket().upload(key, blob, { upsert: true });
    if (error) throw error;
  },
  async delete(key: string): Promise<void> {
    const { error } = await bucket().remove([key]);
    if (error) throw error;
  },
  async list({ prefix }: { prefix: string }): Promise<{ blobs: { key: string }[] }> {
    const keys = await listKeys(prefix.replace(/\/$/, ""));
    return { blobs: keys.filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  },
});
