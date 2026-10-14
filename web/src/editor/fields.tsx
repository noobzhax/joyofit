import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Segmented } from "@/ui/surface";
import { Switch } from "@/ui/switch";
import { cn } from "@/ui/utils";
import { FONTS, fontChoice, nearestWeight } from "@/render/fonts";
import type { FontRef, Outline } from "@/model/types";

const labelClass = "text-[0.8125rem] font-semibold text-muted-foreground";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className={cn("px-0.5", labelClass)}>{label}</div>
      {children}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className={cn("px-0.5", labelClass)}>{label}</span>
      {children}
    </div>
  );
}

const smallInput = "h-8 rounded-lg px-2.5 text-[0.8125rem] font-semibold";

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  label: string;
}) {
  return (
    <Input
      type="number"
      aria-label={label}
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      className={cn(smallInput, "w-20 text-right", className)}
      onChange={(e) => {
        const v = e.currentTarget.valueAsNumber;
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  color,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  color?: string;
  format?: (v: number) => string;
}) {
  const id = useId();
  const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min || 1)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className={cn("px-0.5", labelClass)}>
          {label}
        </label>
        <span className="text-[0.8125rem] font-semibold tabular-nums">
          {format ? format(value) : Math.round(value * 100) / 100}
          {unit && <span className="ml-0.5 text-muted-foreground">{unit}</span>}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": `${pct}%`, ...(color ? { "--slider-color": color } : {}) } as CSSProperties}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

const SWATCHES = ["#FFFFFF", "#F2F7F8", "#5FD3EE", "#FF8FA4", "#6EE7A0", "#F5B35A", "#8F9BE3", "#000000"];

export function ColorField({
  label,
  value,
  onChange,
  swatches = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  swatches?: boolean;
}) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <Field label={label} className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-foreground/15">
          <input
            type="color"
            aria-label={`${label} picker`}
            value={hex}
            onChange={(e) => onChange(e.currentTarget.value.toUpperCase())}
            className="absolute -inset-2 size-12 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
        <Input
          aria-label={`${label} hex`}
          value={value.toUpperCase()}
          maxLength={7}
          className={cn(smallInput, "w-24 font-mono uppercase")}
          onChange={(e) => {
            const v = e.currentTarget.value.startsWith("#") ? e.currentTarget.value : `#${e.currentTarget.value}`;
            if (/^#[0-9a-f]{0,6}$/i.test(v) && v.length === 7) onChange(v.toUpperCase());
          }}
        />
      </div>
      {swatches && (
        <div className="flex gap-1.5 px-0.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              onClick={() => onChange(c)}
              className={cn(
                "size-5 rounded-full ring-1 ring-foreground/20 transition-transform duration-150 hover:scale-110 active:scale-95",
                value.toUpperCase() === c && "ring-2 ring-primary ring-offset-1 ring-offset-card",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </Field>
  );
}

export function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label}>
      <Switch label={label} checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}

export function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <Segmented label={label} value={value} options={options} onChange={onChange} />
    </Field>
  );
}

export function FontField({ value, onChange }: { value: FontRef; onChange: (v: FontRef) => void }) {
  const choice = fontChoice(value.family);
  return (
    <div className="space-y-2">
      <Field label="Font">
        <select
          aria-label="Font family"
          value={value.family}
          onChange={(e) => {
            const family = e.currentTarget.value;
            onChange({ family, weight: nearestWeight(family, value.weight) });
          }}
          className="h-9 w-full rounded-xl border border-transparent bg-muted px-3 text-[0.8125rem] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          {FONTS.map((f) => (
            <option key={f.family} value={f.family}>
              {f.label} · {f.note}
            </option>
          ))}
        </select>
      </Field>
      {choice && choice.weights.length > 1 && (
        <Segmented
          label="Font weight"
          value={String(value.weight)}
          options={choice.weights.map((w) => ({ value: String(w), label: String(w) }))}
          onChange={(w) => onChange({ ...value, weight: Number(w) })}
        />
      )}
    </div>
  );
}

export function OutlineField({ value, onChange, fallback }: { value: Outline; onChange: (v: Outline) => void; fallback: string }) {
  return (
    <div className="space-y-2">
      <ToggleRow label="Outline" checked={value !== null} onChange={(on) => onChange(on ? { color: fallback, width: 2 } : null)} />
      {value && (
        <>
          <ColorField label="Outline color" value={value.color} onChange={(color) => onChange({ ...value, color })} swatches={false} />
          <SliderField label="Outline width" value={value.width} min={1} max={8} onChange={(width) => onChange({ ...value, width })} unit="px" />
        </>
      )}
    </div>
  );
}

export function UploadButton({
  label,
  accept = "image/*",
  onFile,
  variant = "secondary",
}: {
  label: string;
  accept?: string;
  onFile: (file: File) => void;
  variant?: "secondary" | "outline";
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        data-testid="upload-input"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) onFile(f);
        }}
      />
      <Button variant={variant} size="sm" className="w-full" onClick={() => input.current?.click()}>
        <Upload />
        {label}
      </Button>
    </>
  );
}
