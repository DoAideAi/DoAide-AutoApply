import useTheme from "../hooks/useTheme";

function Icon({ children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const OPTIONS = [
  {
    value: "system",
    label: "System",
    icon: (
      <Icon>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </Icon>
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </Icon>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <Icon>
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
      </Icon>
    ),
  },
];

/**
 * System / Light / Dark segmented switch. A radiogroup, so the three choices
 * and the current one are announced as such.
 *
 * `variant="onDark"` is for surfaces that are dark in both themes (the
 * landing hero), where the themed ink scale can't be relied on.
 */
export default function ThemeToggle({ className = "", variant = "default" }) {
  const { preference, setPreference } = useTheme();
  const onDark = variant === "onDark";
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex items-center gap-0.5 rounded-lg p-0.5 ring-1 ${
        onDark ? "bg-white/10 ring-white/10" : "bg-paper ring-line"
      } ${className}`}
    >
      {OPTIONS.map(({ value, label, icon }) => {
        const on = preference === value;
        const tone = onDark
          ? on
            ? "bg-white/15 text-white"
            : "text-white/50 hover:text-white"
          : on
            ? "bg-canvas text-brand-500 shadow-sm"
            : "text-ink-400 hover:text-ink-900";
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setPreference(value)}
            className={`inline-flex items-center justify-center rounded-md p-1.5 transition-colors ${tone}`}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}
