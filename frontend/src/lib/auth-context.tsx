"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthUser } from "./types";
import {
  AUTH_CHANGED_EVENT,
  clearStoredAuth,
  hydrateSessionFromStorage,
  type StoredAuth,
  writeStoredAuth,
} from "./session";

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  ready: boolean;
  setSession: (session: StoredAuth) => void;
  clearSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const applySession = useCallback((session: StoredAuth | null) => {
    if (!session) {
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
      return;
    }
    setUser(session.user);
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken);
  }, []);

  useEffect(() => {
    applySession(hydrateSessionFromStorage());
    setReady(true);

    const onChange = () => {
      applySession(hydrateSessionFromStorage());
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onChange);
  }, [applySession]);

  const setSession = useCallback(
    (session: StoredAuth) => {
      writeStoredAuth(session);
      applySession(session);
    },
    [applySession],
  );

  const clearSession = useCallback(() => {
    clearStoredAuth();
    applySession(null);
  }, [applySession]);

  const value = useMemo(
    () => ({
      user,
      accessToken,
      refreshToken,
      ready,
      setSession,
      clearSession,
    }),
    [user, accessToken, refreshToken, ready, setSession, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
