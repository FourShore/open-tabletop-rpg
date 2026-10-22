/** Tiny router: /, /screen/CODE and /play/CODE. */
export function navigate(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}
