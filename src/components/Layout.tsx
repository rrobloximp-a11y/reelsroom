import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { Avatar } from "./Avatar";
import { Ambient, useSiteTheme } from "./Ambient";
import { GiftPopup } from "./GiftPopup";
import { IconFlame, IconHome, IconShorts, IconMenu, IconSearch, IconStudio, IconSubs, IconShield, IconUpload, IconUser, IconGear, IconSparkle } from "./Icons";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Reelroom home">
      <span className="logo-mark">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
          <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M13.5 11.5 21 16l-7.5 4.5z" fill="currentColor" />
        </svg>
      </span>
      <span className="logo-word">reelroom</span>
    </Link>
  );
}

function SearchBox() {
  const [params] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    if (loc.pathname === "/search") setQ(params.get("q") ?? "");
  }, [loc.pathname, params]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
  };
  return (
    <form className="search" onSubmit={submit} role="search">
      <IconSearch />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos and channels" aria-label="Search" />
      <kbd>/</kbd>
    </form>
  );
}

function UserMenu() {
  const { user, channel, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!user) {
    return (
      <Link to="/signin" className="btn btn-ghost">
        <IconUser /> Sign in
      </Link>
    );
  }
  return (
    <div className="usermenu" ref={ref}>
      <button className="usermenu-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu">
        <Avatar name={channel?.name ?? user.email} handle={channel?.handle ?? user.email} id={channel?.id} v={channel?.avatarVersion} frame={channel?.frame} size={34} />
      </button>
      {open && (
        <div className="menu pop">
          <div className="menu-head">
            <strong>{channel?.name ?? "No channel yet"}</strong>
            <span>{channel ? `@${channel.handle}` : user.email}</span>
          </div>
          {channel ? (
            <>
              <Link to={`/c/${channel.handle}`} onClick={() => setOpen(false)}>Your channel</Link>
              <Link to="/studio" onClick={() => setOpen(false)}>Studio</Link>
              <Link to="/setup" onClick={() => setOpen(false)}>Edit channel</Link>
              <Link to="/decorations" onClick={() => setOpen(false)}>Decorations</Link>
              <Link to="/settings" onClick={() => setOpen(false)}>Settings</Link>
              {channel.isAdmin && <Link to="/admin" onClick={() => setOpen(false)}>Admin</Link>}
            </>
          ) : (
            <Link to="/setup" onClick={() => setOpen(false)}>Create your channel</Link>
          )}
          <button
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { channel, notice, clearNotice, site } = useAuth();
  const siteTheme = useSiteTheme(site.season);
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  const isWatch = loc.pathname.startsWith("/watch/");
  useEffect(() => setNavOpen(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement).closest("input,textarea")) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`shell ${isWatch ? "shell-watch" : ""} ${navOpen ? "nav-open" : ""}`}>
      <header className="topbar">
        <button className="iconbtn nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation">
          <IconMenu />
        </button>
        <Logo />
        <SearchBox />
        <div className="topbar-actions">
          <Link to="/upload" className="btn btn-accent">
            <IconUpload /> <span>Upload</span>
          </Link>
          <UserMenu />
        </div>
      </header>

      <nav className="sidebar" aria-label="Main">
        <NavLink to="/" end><IconHome /> Home</NavLink>
        <NavLink to="/shorts"><IconShorts /> Shorts</NavLink>
        <NavLink to="/trending"><IconFlame /> Trending</NavLink>
        <NavLink to="/subscriptions"><IconSubs /> Subscriptions</NavLink>
        <div className="sidebar-rule" />
        {channel ? (
          <>
            <NavLink to={`/c/${channel.handle}`}><IconUser /> Your channel</NavLink>
            <NavLink to="/studio"><IconStudio /> Studio</NavLink>
            <NavLink to="/decorations"><IconSparkle /> Decorations</NavLink>
            <NavLink to="/settings"><IconGear /> Settings</NavLink>
            {channel.isAdmin && <NavLink to="/admin"><IconShield /> Admin</NavLink>}
          </>
        ) : (
          <div className="sidebar-pitch">
            <p>Every reel needs a room. Start a channel and put your work on screen.</p>
            <Link to="/setup" className="btn btn-outline btn-sm">Start a channel</Link>
          </div>
        )}
        <footer className="sidebar-foot">Reelroom · made for makers</footer>
      </nav>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      {!isWatch && !loc.pathname.startsWith("/shorts") && <Ambient theme={siteTheme} />}
      <GiftPopup />
      <main className="main">
        {notice && (
          <div className="toast pop" role="status">
            {notice}
            <button onClick={clearNotice} aria-label="Dismiss">×</button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
