export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--accent)" />
      <path
        d="M9 20.5c2.5 2.2 5.6 2.6 8 1.4 3.3-1.6 2.6-5.2-.8-6-3.3-.8-5.2-2.6-3.6-5 1.6-2.3 5.6-2 7.8.4"
        fill="none"
        stroke="var(--accent-text)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="22.8" cy="10.6" r="1.8" fill="var(--accent-text)" />
    </svg>
  );
}
