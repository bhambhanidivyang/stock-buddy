import type { AuthUser } from "./types";

export const AUTH_STORAGE_KEY = "stock-buddy-auth";
export const AUTH_CHANGED_EVENT = "stock-buddy-auth-changed";

export type StoredAuth = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

let memorySession: StoredAuth | null = null;

export function getMemorySession(): StoredAuth | null {
  return memorySession;
}

export function readStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAuth>;
    if (
      !parsed?.user ||
      !parsed.accessToken ||
      typeof parsed.refreshToken !== "string" ||
      !parsed.refreshToken
    ) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return parsed as StoredAuth;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function writeStoredAuth(session: StoredAuth): void {
  memorySession = session;
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearStoredAuth(): void {
  memorySession = null;
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function hydrateSessionFromStorage(): StoredAuth | null {
  const session = readStoredAuth();
  memorySession = session;
  return session;
}
