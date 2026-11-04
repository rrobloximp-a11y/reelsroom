// Browser-side helpers for reading a local video file before upload.

export const MAX_BYTES = 500 * 1024 * 1024;
export const ACCEPT = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

export function probeVideo(file: File): Promise<{ duration: number; el: HTMLVideoElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "auto";
    el.muted = true;
    el.playsInline = true;
    el.src = url;
    el.onloadedmetadata = () => resolve({ duration: el.duration, el, url });
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This browser can't play that file. Try an MP4 (H.264) or WebM video."));
    };
  });
}

function seek(el: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      el.removeEventListener("seeked", done);
      resolve();
    };
    el.addEventListener("seeked", done);
    el.currentTime = t;
    setTimeout(done, 4000);
  });
}

function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#15110e";
  ctx.fillRect(0, 0, 1280, 720);
  const scale = Math.min(1280 / w, 720 / h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(source, (1280 - dw) / 2, (720 - dh) / 2, dw, dh);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create thumbnail"))), "image/jpeg", 0.85),
  );
}

export async function frameThumbnails(el: HTMLVideoElement, duration: number): Promise<Blob[]> {
  const points = [0.12, 0.45, 0.78].map((p) => Math.min(duration * p, Math.max(0, duration - 0.1)));
  const out: Blob[] = [];
  for (const t of points) {
    await seek(el, t);
    if (!el.videoWidth) continue;
    out.push(await toJpeg(el, el.videoWidth, el.videoHeight));
  }
  return out;
}

export async function imageToThumbnail(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  return toJpeg(bmp, bmp.width, bmp.height);
}

// Center-crops an image file to exactly w×h and encodes it as JPEG (used for channel icons and banners).
export async function cropImage(file: File, w: number, h: number): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file (JPG, PNG, WebP or GIF).");
  if (file.size > 20 * 1024 * 1024) throw new Error("Images can be up to 20 MB.");
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error("This browser can't read that image.");
  });
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * scale;
  const dh = bmp.height * scale;
  ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that image."))), "image/jpeg", 0.88),
  );
}

// Shrinks an image so its longest side is at most `max` px and encodes it as JPEG (used for post images).
export async function fitImage(file: File, max = 1600): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file (JPG, PNG, WebP or GIF).");
  if (file.size > 20 * 1024 * 1024) throw new Error("Images can be up to 20 MB.");
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error("This browser can't read that image.");
  });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#15110e";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that image."))), "image/jpeg", 0.86),
  );
}
