import * as SecureStore from 'expo-secure-store';

// phone: keep the session in the keychain / keystore
const KEY = 'kerf.session';

export const tokenStorage = {
  load: () => SecureStore.getItemAsync(KEY),
  save: (value: string) => SecureStore.setItemAsync(KEY, value),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
