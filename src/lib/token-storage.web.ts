// browser has no keychain, so we use localStorage to stay signed in
const KEY = 'kerf.session';

function storage() {
  // no localStorage during server render
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export const tokenStorage = {
  load: async () => storage()?.getItem(KEY) ?? null,
  save: async (value: string) => storage()?.setItem(KEY, value),
  clear: async () => storage()?.removeItem(KEY),
};
