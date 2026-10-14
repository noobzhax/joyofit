import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./utils";

/**
 * Modal built on the native <dialog>: focus trap, Escape and the backdrop come from the platform.
 * Styled as a JoyoRogo card (white, borderless, large radius).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      data-testid={testId}
      className="sheet m-auto backdrop:bg-black/40"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className={cn("sheet-body flex max-h-[min(46rem,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-3xl bg-card text-card-foreground shadow-float", className)}>
        <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-3">
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">{footer}</footer>}
      </div>
    </dialog>
  );
}
