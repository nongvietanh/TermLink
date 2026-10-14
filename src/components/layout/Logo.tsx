import { cn } from "@/lib/utils";

/** TermLink mark: a prompt chevron joined to a link of two nodes. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={cn("size-6", className)} aria-hidden="true">
      <defs>
        <linearGradient id="tl-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14203d" />
          <stop offset="1" stopColor="#070b17" />
        </linearGradient>
        <linearGradient id="tl-logo-accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="220" fill="url(#tl-logo-bg)" />
      <rect
        x="48.5"
        y="48.5"
        width="927"
        height="927"
        rx="219.5"
        fill="none"
        stroke="#22d3ee"
        strokeOpacity="0.3"
        strokeWidth="10"
      />
      <path
        d="M248 352 L432 512 L248 672"
        fill="none"
        stroke="url(#tl-logo-accent)"
        strokeWidth="84"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="560"
        y1="640"
        x2="760"
        y2="640"
        stroke="#e2f8ff"
        strokeWidth="56"
        strokeLinecap="round"
      />
      <circle
        cx="560"
        cy="640"
        r="62"
        fill="#070b17"
        stroke="url(#tl-logo-accent)"
        strokeWidth="40"
      />
      <circle
        cx="776"
        cy="640"
        r="62"
        fill="#070b17"
        stroke="url(#tl-logo-accent)"
        strokeWidth="40"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[13px] font-semibold tracking-tight text-fg">
        Term<span className="text-accent">Link</span>
      </span>
    </div>
  );
}
