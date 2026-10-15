import { cva, type VariantProps } from "class-variance-authority";
import type { AnchorHTMLAttributes } from "react";

import { cn } from "./lib";

// Same variants as JoyoRogo's Button (packages/ui), rendered as links.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent text-[0.9375rem] font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.125rem]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border-border bg-card text-foreground hover:bg-muted",
        secondary:
          "bg-muted text-foreground hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)]",
        ghost: "text-foreground hover:bg-muted",
      },
      size: {
        default: "h-12 px-5",
        lg: "h-14 px-6 text-base",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof buttonVariants>) {
  return <a className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

/** GitHub's mark; lucide dropped brand icons. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/** Circular progress in the style of JoyoRogo's Ring (static, no animation needed here). */
export function Ring({
  value,
  max,
  tone,
  size = 96,
  stroke = 9,
  label,
  children,
}: {
  value: number;
  max: number;
  tone: "makan" | "bakar" | "tidur";
  size?: number;
  stroke?: number;
  label: string;
  children?: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, value / max));
  const c = size / 2;
  const track = { makan: "stroke-makan-soft", bakar: "stroke-bakar-soft", tidur: "stroke-tidur-soft" }[tone];
  const arc = { makan: "stroke-makan", bakar: "stroke-bakar", tidur: "stroke-tidur" }[tone];
  return (
    <div
      role="img"
      aria-label={label}
      className="relative grid shrink-0 place-items-center text-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={c} cy={c} r={radius} fill="none" strokeWidth={stroke} className={track} />
        <circle
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={arc}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Phone frame from JoyoRogo's HeroPhone, around a real app screenshot. */
export function Phone({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div
      className={cn(
        "relative mx-auto w-[16.5rem] rounded-[2.6rem] bg-[oklch(0.22_0.01_85)] p-[7px] shadow-float md:w-[17.5rem]",
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        width={640}
        height={1280}
        loading="lazy"
        decoding="async"
        className="block w-full rounded-[2.2rem] bg-background"
      />
    </div>
  );
}
