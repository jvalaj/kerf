import type {
  Group,
  LoginResponse,
  Measurement,
  NewMeasurement,
  Project,
  Unit,
} from '@kerf/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { endSession, getToken, startSession } from '@/lib/session';

const API_PORT = 4000;

// same machine as expo: localhost in browser, computer wifi address on phone
export function apiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  const host =
    Platform.OS === 'web'
      ? globalThis.location?.hostname
      : Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:${API_PORT}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(apiUrl() + path, {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    // token is bad or signed out
    if (res.status === 401 && token) endSession(token);
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json();
}

export const api = {
  async signIn(username: string, password: string) {
    startSession(
      await request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    );
  },
  async signOut() {
    const token = getToken();
    // remove session on server; still sign out here if that call fails
    await send('/auth/logout', { method: 'POST' }).catch(() => {});
    endSession(token);
  },
  projects: () => request<Project[]>('/projects'),
  measurements: (projectId: number) => request<Group[]>(`/projects/${projectId}/measurements`),
  addMeasurement: (groupId: number, measurement: NewMeasurement) =>
    request<Measurement>(`/groups/${groupId}/measurements`, {
      method: 'POST',
      body: JSON.stringify(measurement),
    }),
  exportCsv: (unit: Unit, timeZone: string) =>
    send(`/export/measurements.csv?unit=${unit}&tz=${encodeURIComponent(timeZone)}`),
  reset: () => request<{ ok: true }>('/dev/reset', { method: 'POST' }),
};
