"use client";

import { createContext, useContext, useCallback } from "react";
import { useRouter } from "next/navigation";

const SessionContext = createContext(null);

export function SessionProvider({ initialUser, children }) {
  const router = useRouter();
  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }, [router]);

  return (
    <SessionContext.Provider value={{ user: initialUser, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
