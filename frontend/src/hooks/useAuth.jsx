import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useToast } from "../components/ui/Toast";
import { SESSION_EXPIRED_EVENT, api, getToken, setToken } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const userRef = useRef(null);
  userRef.current = user;

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // The API client drops the token on a 401; this drops the user with it, so
  // <Protected> sends them to sign in instead of leaving a page that can no
  // longer load anything.
  useEffect(() => {
    function expired() {
      if (userRef.current) toast.error("Your session has expired — please sign in again.");
      setUser(null);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [toast]);

  async function login(email, password) {
    await api.login(email, password);
    setUser(await api.me());
  }

  async function register(email, password, fullName) {
    await api.register(email, password, fullName);
    await login(email, password);
  }

  function logout() {
    api.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
