/**
 * After a deploy the new service worker takes over while the old page is still on screen (and
 * would keep showing the old version until the next visit). Reload once when that happens so
 * people see the current version. The very first install has no previous controller and must
 * not reload. Also checks for a new version whenever the page becomes visible again, which
 * matters for installed apps that stay open for days.
 */
export function reloadWhenUpdated(): void {
  if (!('serviceWorker' in navigator)) return;
  const hadController = navigator.serviceWorker.controller !== null;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void navigator.serviceWorker.getRegistration().then((registration) => registration?.update());
  });
}
