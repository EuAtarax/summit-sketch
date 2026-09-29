/** Lowercase ASCII slug for file names: "Östliche Griesspitze" becomes "ostliche-griesspitze". */
export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'panorama'
  );
}

export function exportFilename(summit: string, styleId: string, kind: '360' | 'view'): string {
  return `summit-sketch-${slugify(summit)}-${styleId}-${kind}.png`;
}

export type DeliveryResult = 'shared' | 'downloaded' | 'cancelled';

/** Touch devices share (the native sheet offers save, messages, etc.); desktops download. */
const prefersShare = () => matchMedia('(pointer: coarse)').matches;

/**
 * Hands the image to the user: the Web Share sheet with the file on touch devices that
 * support it, a download everywhere else. Dismissing the share sheet is not an error.
 */
export async function deliverImage(blob: Blob, filename: string): Promise<DeliveryResult> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (prefersShare() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // The browser has started reading the blob by the next turn; free it afterwards.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export type LinkResult = 'shared' | 'copied' | 'cancelled';

/**
 * Shares the panorama link: the native share sheet on touch devices, the clipboard elsewhere.
 * The address bar always holds the current link (lat, lon, radius, style, labels).
 */
export async function shareLink(url: string, title: string): Promise<LinkResult> {
  if (prefersShare() && navigator.share) {
    try {
      await navigator.share({ url, title });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
