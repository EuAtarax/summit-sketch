export const OFFLINE_MESSAGE =
  "You're offline. Areas you have opened before still work; new ones need a connection.";

/** True when the browser reports no network. */
export const isOffline = (): boolean => !navigator.onLine;

/** A banner that shows while the browser is offline. */
export function mountOfflineBanner(parent: HTMLElement): void {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = OFFLINE_MESSAGE;
  const sync = () => (banner.hidden = !isOffline());
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
  parent.append(banner);
}
