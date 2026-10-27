import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import Logo from "./ui/Logo";
import ThemeToggle from "./ThemeToggle";
import { api } from "../lib/api";
import { onCountsChanged } from "../lib/events";

const TABS = [
  { to: "/pipeline", label: "Pipeline" },
  { to: "/jobs", label: "Jobs" },
  { to: "/inbox", label: "Inbox" },
  { to: "/setup", label: "Setup" },
];

export default function Shell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const counts = useNavCounts(location.pathname);
  const tabs = TABS;

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <div className="flex min-w-0 items-center gap-5 sm:gap-8">
            <Wordmark />
            <nav className="hidden items-center gap-1 overflow-x-auto sm:flex">
              {tabs.map((tab) => (
                <Tab key={tab.to} to={tab.to} end={tab.end} badge={badgeFor(tab, counts)}>
                  {tab.label}
                </Tab>
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden font-mono text-xs text-ink-400 lg:block">
              {user?.email}
            </span>
            <ThemeToggle className="hidden sm:inline-flex" />
            <button
              className="btn-quiet hidden sm:inline-flex"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>

            <button
              className="btn-quiet -mr-1 inline-flex sm:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
            >
              <MenuGlyph open={menuOpen} />
              {counts.review + counts.inbox > 0 && !menuOpen && (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-line px-3 py-2 sm:hidden">
            {tabs.map((tab) => (
              <MobileTab key={tab.to} to={tab.to} end={tab.end} badge={badgeFor(tab, counts)}>
                {tab.label}
              </MobileTab>
            ))}
            <div className="mt-1 flex items-center justify-between px-3 py-2">
              <span className="text-sm text-ink-400">Theme</span>
              <ThemeToggle />
            </div>
            <button
              className="mt-1 block w-full rounded-md px-3 py-2.5 text-left text-sm text-ink-400 hover:bg-paper hover:text-ink-900"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">{children}</main>

      <footer className="border-t border-line px-4 py-4 text-center">
        <div className="mb-2 flex flex-wrap justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em]">
          <a href="https://desk.doaide.com" target="_blank" rel="noopener noreferrer" className="text-ink-400/60 no-underline hover:text-brand-500">Desk</a>
          <a href="https://pulse.doaide.com" target="_blank" rel="noopener noreferrer" className="text-ink-400/60 no-underline hover:text-brand-500">Pulse</a>
          <a href="https://409.doaide.com" target="_blank" rel="noopener noreferrer" className="text-ink-400/60 no-underline hover:text-brand-500">409A</a>
          <span className="text-brand-500">AutoApply</span>
          <a href="https://realty.doaide.com" target="_blank" rel="noopener noreferrer" className="text-ink-400/60 no-underline hover:text-brand-500">Realty</a>
          <a href="https://med.doaide.com" target="_blank" rel="noopener noreferrer" className="text-ink-400/60 no-underline hover:text-brand-500">Med</a>
          <a href="https://gst.doaide.com" target="_blank" rel="noopener noreferrer" className="text-ink-400/60 no-underline hover:text-brand-500">GST</a>
          <a href="https://reach.doaide.com" target="_blank" rel="noopener noreferrer" className="text-ink-400/60 no-underline hover:text-brand-500">Reach</a>
        </div>
        <p className="text-xs text-ink-400/40">
          <a href="https://doaide.com" className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-400/60 no-underline transition-colors hover:border-brand-500 hover:text-brand-500" target="_blank" rel="noopener noreferrer">
            A DoAide Product
          </a>
          <span className="mx-2">&middot;</span>
          &copy; {new Date().getFullYear()} DoAide
        </p>
      </footer>
    </div>
  );
}

function useNavCounts(pathname) {
  const [counts, setCounts] = useState({ review: 0, inbox: 0 });

  useEffect(() => {
    let cancelled = false;
    const fetchCounts = () =>
      Promise.all([
        api.review().catch(() => null),
        api.inbox().catch(() => null),
      ]).then(([queue, inbox]) => {
        if (cancelled) return;
        setCounts({
          review: queue?.count ?? 0,
          inbox: inbox?.counts?.unread ?? 0,
        });
      });
    fetchCounts();
    const timer = setInterval(fetchCounts, 30000);
    const unsubscribe = onCountsChanged(fetchCounts);
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [pathname]);

  return counts;
}

function badgeFor(tab, counts) {
  if (tab.to !== "/inbox") return null;
  const total = counts.inbox + counts.review;
  return total > 0 ? { value: total, label: "waiting on you" } : null;
}

function Wordmark() {
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <Logo className="h-[26px] w-[26px] shrink-0 text-brand-500" title="DoAide AutoApply" />
      <span className="text-base font-semibold text-ink-900">
        DoAide <span className="text-ink-400">|</span> <span className="text-brand-500">AutoApply</span>
      </span>
    </span>
  );
}

function Tab({ to, end, badge, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "relative shrink-0 whitespace-nowrap rounded-md py-1.5 text-sm",
          badge ? "pl-3 pr-7" : "px-3",
          "transition-colors",
          isActive ? "text-ink-900 font-medium" : "text-ink-400 hover:text-ink-700",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          {children}
          {badge && <CountBadge {...badge} />}
          {isActive && (
            <span className="absolute inset-x-3 -bottom-[13px] h-px bg-brand-500" />
          )}
        </>
      )}
    </NavLink>
  );
}

function MobileTab({ to, end, badge, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "flex items-center justify-between rounded-md px-3 py-2.5 text-sm transition-colors",
          isActive
            ? "bg-brand-50 text-ink-900"
            : "text-ink-500 hover:bg-paper hover:text-ink-900",
        ].join(" ")
      }
    >
      <span>{children}</span>
      {badge && <CountBadge {...badge} inline />}
    </NavLink>
  );
}

function CountBadge({ value, label, inline = false }) {
  return (
    <span
      className={[
        inline ? "" : "absolute right-1 top-1/2 -translate-y-1/2",
        "inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-brand-500 px-1",
        "font-mono text-[10px] font-semibold leading-[1.15rem] text-white",
      ].join(" ")}
      aria-label={`${value} ${label}`}
    >
      {value > 9 ? "9+" : value}
    </span>
  );
}

function MenuGlyph({ open }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      {open ? (
        <>
          <path d="M5 5l10 10" />
          <path d="M15 5L5 15" />
        </>
      ) : (
        <>
          <path d="M3 6h14" />
          <path d="M3 10h14" />
          <path d="M3 14h14" />
        </>
      )}
    </svg>
  );
}
