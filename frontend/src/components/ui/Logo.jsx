// Eyes and smile are white so they read against the face whatever colour the
// face takes (teal in light, bright teal in dark, on any background); the
// pupils carry the deep ink.
const EYE = "#FFFFFF";
const PUPIL = "#042F2E";

/** The DoAide robot mark. The face takes `currentColor` (text-brand-500). */
export default function Logo({ className = "h-6 w-6", title }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
    >
      {title && <title>{title}</title>}
      <line x1="16" y1="6" x2="16" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="1.5" r="1.5" fill="currentColor" />
      <rect x="5" y="6" width="22" height="17" rx="5" fill="currentColor" />
      <ellipse cx="11" cy="13" rx="2.5" ry="3" fill={EYE} data-part="eye" />
      <ellipse cx="21" cy="13" rx="2.5" ry="3" fill={EYE} data-part="eye" />
      <circle cx="11.5" cy="13.5" r="1.2" fill={PUPIL} />
      <circle cx="21.5" cy="13.5" r="1.2" fill={PUPIL} />
      <path d="M12 19Q16 22 20 19" stroke={EYE} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <rect x="1" y="10" width="4" height="5" rx="2" fill="currentColor" opacity="0.8" />
      <rect x="27" y="10" width="4" height="5" rx="2" fill="currentColor" opacity="0.8" />
    </svg>
  );
}
