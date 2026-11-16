import * as SecureStore from 'expo-secure-store';

// on a phone the session lives in the keychain / keystore.
const KEY = 'kerf.session';

export const tokenStorage = {
  load: () => SecureStore.getItemAsync(KEY),
  save: (value: string) => SecureStore.setItemAsync(KEY, value),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
