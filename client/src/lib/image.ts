/** A decoded, re-encoded image: the data URL plus the size it actually came out at. */
export interface ResizedImage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Read an image File and re-encode it as a JPEG data URL, longest side capped at `max` px.
 *
 * JPEG has no alpha channel, so the canvas is filled white first: the file inputs accept
 * `image/*`, and a PNG or WebP logo with a transparent background was otherwise encoded straight
 * onto the fresh, fully transparent canvas, which JPEG renders as black (CCL-10).
 *
 * Two callers with different needs, which is why the size is a parameter and the *shape* of the
 * result is not the avatar's: `resizeToDataUrl` below keeps the 256 px contract of `artists.image`
 * (bytes inline in the row, carried by COPY_COLS), while WP-37's hall plans want detail and their
 * bytes go to the `images` table instead. Generalising underneath rather than widening the old
 * signature keeps that stored-format contract exactly where it was.
 */
export function resizeImage(
  file: File,
  { max = 256, quality = 0.85 }: { max?: number; quality?: number } = {},
): Promise<ResizedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Datei konnte nicht gelesen werden'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas nicht verfügbar'));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The artist profile picture: 256 px, JPEG, stored inline in `artists.image` as a data URL so
 * backups and season-copy carry it automatically. Unchanged contract — see `resizeImage`.
 */
export async function resizeToDataUrl(file: File, max = 256): Promise<string> {
  return (await resizeImage(file, { max })).dataUrl;
}

/**
 * An image for the flowing text (WP-37): bigger, because a Saalplan carries detail an avatar does
 * not. 1200 px across a ~120 mm print column is ~254 dpi, and covers a 2× display at ~600 CSS px;
 * at q0.82 that lands around 150–350 KB, well under the server's 1.5 MB ceiling even after
 * base64's +33 %.
 */
export const TEXT_IMAGE_MAX = 1200;

export function resizeTextImage(file: File): Promise<ResizedImage> {
  return resizeImage(file, { max: TEXT_IMAGE_MAX, quality: 0.82 });
}
