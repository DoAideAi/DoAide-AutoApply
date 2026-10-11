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
      <rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize="16"
        fill="white"
      >
        J
      </text>
    </svg>
  );
}
