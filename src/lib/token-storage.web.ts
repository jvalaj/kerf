// a browser has no keychain. localstorage keeps people signed in across reloads and tabs; the
// trade-off is that script running on this origin could read the token. the alternative, an
// httponly cookie, would need the api on the same site as the app plus csrf protection, and
// phones and api clients would still need bearer tokens.
const KEY = 'kerf.session';

function storage() {
  // undefined while the page is rendered on the server.
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export const tokenStorage = {
  load: async () => storage()?.getItem(KEY) ?? null,
  save: async (value: string) => storage()?.setItem(KEY, value),
  clear: async () => storage()?.removeItem(KEY),
};
