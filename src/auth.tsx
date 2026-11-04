import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { handleAuthCallback, logout as idLogout, onAuthChange } from "@netlify/identity";
import { api, type CoinGift, type MyChannel as Channel, type SiteInfo } from "./api";

type Me = { id: string; email: string; name?: string } | null;
type AuthState = {
  ready: boolean;
  user: Me;
  channel: Channel | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setChannel: (c: Channel | null) => void;
  recovery: boolean;
  clearRecovery: () => void;
  notice: string | null;
  clearNotice: () => void;
  site: SiteInfo;
  setSite: (s: SiteInfo) => void;
  gifts: CoinGift[];
  dismissGifts: () => void;
};

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Me>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [site, setSite] = useState<SiteInfo>({ season: "" });
  const [gifts, setGifts] = useState<CoinGift[]>([]);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: Me; channel: Channel | null; site?: SiteInfo; gifts?: CoinGift[] }>("/me");
      setUser(me.user);
      setChannel(me.channel);
      if (me.site) setSite(me.site);
      setGifts(me.gifts ?? []);
    } catch {
      setUser(null);
      setChannel(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const result = await handleAuthCallback();
        if (result?.type === "recovery") setRecovery(true);
        if (result?.type === "confirmation") setNotice("Email confirmed — you're signed in.");
        if (result?.type === "email_change") setNotice("Your email address has been updated.");
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Sign-in link is invalid or expired.");
      }
      await refresh();
      setReady(true);
    })();
    return onAuthChange(() => void refresh());
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await idLogout();
    } finally {
      setUser(null);
      setChannel(null);
      setGifts([]);
    }
  }, []);

  const dismissGifts = useCallback(() => {
    setGifts((list) => {
      const top = Math.max(0, ...list.map((g) => g.id));
      if (top) void api("/me/gifts/seen", { json: { id: top } }).catch(() => {});
      return [];
    });
  }, []);

  return (
    <Ctx.Provider
      value={{
        ready,
        user,
        channel,
        refresh,
        logout,
        setChannel,
        recovery,
        clearRecovery: () => setRecovery(false),
        notice,
        clearNotice: () => setNotice(null),
        site,
        setSite,
        gifts,
        dismissGifts,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
