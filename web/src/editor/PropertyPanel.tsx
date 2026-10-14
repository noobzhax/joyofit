import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { addAssetFromFile, getAsset } from "@/model/assets";
import { ELEMENT_LABELS, newWidget } from "@/model/defaults";
import {
  WIDGET_LABELS,
  type BackgroundElement,
  type DateElement,
  type DatePart,
  type Element,
  type HandElement,
  type ImageElement,
  type RingElement,
  type TimeElement,
  type WidgetElement,
} from "@/model/types";
import { elementSupport } from "@/export/support";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { cn } from "@/ui/utils";
import {
  ColorField,
  FontField,
  NumberInput,
  OutlineField,
  Row,
  SegmentedField,
  SliderField,
  ToggleRow,
  UploadButton,
} from "./fields";
import { useEditor } from "./store";

type Patch<T extends Element> = (patch: Partial<T>) => void;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="px-0.5 text-sm font-bold tracking-tight">{title}</h3>
      {children}
    </section>
  );
}

function PositionFields({ el, set, pivot }: { el: Element; set: Patch<Element>; pivot?: boolean }) {
  return (
    <Section title={pivot ? "Pivot position" : "Position"}>
      <div className="grid grid-cols-2 gap-3">
        <Row label="X">
          <NumberInput label="X" value={el.x} min={-400} max={800} onChange={(x) => set({ x: Math.round(x) })} />
        </Row>
        <Row label="Y">
          <NumberInput label="Y" value={el.y} min={-400} max={900} onChange={(y) => set({ y: Math.round(y) })} />
        </Row>
      </div>
    </Section>
  );
}

function BackgroundFields({ el, set }: { el: BackgroundElement; set: Patch<BackgroundElement> }) {
  const fill = el.fill;
  const upload = async (file: File) => {
    try {
      const assetId = await addAssetFromFile(file, "photo");
      set({ fill: { kind: "image", assetId, zoom: 1, offsetX: 0, offsetY: 0, dim: fill.kind === "image" ? fill.dim : 0.25 } });
    } catch {
      toast.error("That file could not be read as an image.");
    }
  };
  return (
    <Section title="Background">
      <SegmentedField
        label="Fill"
        value={fill.kind}
        options={[
          { value: "solid", label: "Solid" },
          { value: "gradient", label: "Gradient" },
          { value: "image", label: "Photo" },
        ]}
        onChange={(kind) => {
          if (kind === "solid") set({ fill: { kind, color: fill.kind === "solid" ? fill.color : "#000000" } });
          else if (kind === "gradient")
            set({ fill: { kind, from: fill.kind === "gradient" ? fill.from : "#0F2F3A", to: fill.kind === "gradient" ? fill.to : "#000000", angle: 180 } });
          else set({ fill: { kind, assetId: fill.kind === "image" ? fill.assetId : null, zoom: 1, offsetX: 0, offsetY: 0, dim: 0.25 } });
        }}
      />
      {fill.kind === "solid" && <ColorField label="Color" value={fill.color} onChange={(color) => set({ fill: { ...fill, color } })} />}
      {fill.kind === "gradient" && (
        <>
          <ColorField label="From" value={fill.from} onChange={(from) => set({ fill: { ...fill, from } })} />
          <ColorField label="To" value={fill.to} onChange={(to) => set({ fill: { ...fill, to } })} />
          <SliderField label="Angle" value={fill.angle} min={0} max={360} unit="°" onChange={(angle) => set({ fill: { ...fill, angle } })} />
        </>
      )}
      {fill.kind === "image" && (
        <>
          <UploadButton label={fill.assetId ? "Replace photo" : "Upload photo"} onFile={upload} />
          {fill.assetId && (
            <>
              <p className="px-0.5 text-xs text-muted-foreground">Drag on the preview to reposition the photo.</p>
              <SliderField label="Zoom" value={fill.zoom} min={1} max={3} step={0.01} unit="×" onChange={(zoom) => set({ fill: { ...fill, zoom } })} />
              <SliderField label="Horizontal" value={fill.offsetX} min={-1} max={1} step={0.01} onChange={(offsetX) => set({ fill: { ...fill, offsetX } })} />
              <SliderField label="Vertical" value={fill.offsetY} min={-1} max={1} step={0.01} onChange={(offsetY) => set({ fill: { ...fill, offsetY } })} />
              <SliderField
                label="Dim for legibility"
                value={fill.dim}
                min={0}
                max={0.8}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(dim) => set({ fill: { ...fill, dim } })}
              />
            </>
          )}
        </>
      )}
    </Section>
  );
}

function TimeFields({ el, set }: { el: TimeElement; set: Patch<TimeElement> }) {
  return (
    <>
      <Section title="Digits">
        <FontField value={el.font} onChange={(font) => set({ font })} />
        <SliderField label="Digit height" value={el.size} min={24} max={240} unit="px" onChange={(size) => set({ size })} />
        <ColorField label="Color" value={el.color} onChange={(color) => set({ color })} />
        <OutlineField value={el.outline} onChange={(outline) => set({ outline })} fallback="#000000" />
        <SliderField label="Spacing" value={el.tracking} min={-8} max={30} unit="px" onChange={(tracking) => set({ tracking })} />
      </Section>
      <Section title="Layout">
        <SegmentedField
          label="Arrangement"
          value={el.layout}
          options={[
            { value: "row", label: "One row" },
            { value: "stack", label: "Stacked" },
          ]}
          onChange={(layout) => set({ layout })}
        />
        {el.layout === "row" && <ToggleRow label="Colon" checked={el.showColon} onChange={(showColon) => set({ showColon })} />}
        <ToggleRow label="Seconds" checked={el.showSeconds} onChange={(showSeconds) => set({ showSeconds })} />
        <ToggleRow label="12 hour clock with AM/PM" checked={el.ampm} onChange={(ampm) => set({ ampm })} />
        {(el.showSeconds || el.ampm) && (
          <SliderField
            label="Seconds and AM/PM size"
            value={el.secondsScale}
            min={0.2}
            max={0.8}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(secondsScale) => set({ secondsScale })}
          />
        )}
      </Section>
    </>
  );
}

const DATE_PARTS: Array<{ part: DatePart; label: string }> = [
  { part: "weekday", label: "Weekday" },
  { part: "day", label: "Day" },
  { part: "month", label: "Month" },
];

function DateFields({ el, set }: { el: DateElement; set: Patch<DateElement> }) {
  return (
    <>
      <Section title="Shows">
        <div className="flex gap-1.5">
          {DATE_PARTS.map(({ part, label }) => {
            const on = el.parts.includes(part);
            return (
              <button
                key={part}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? el.parts.filter((p) => p !== part) : [...el.parts, part];
                  if (next.length > 0) set({ parts: next });
                }}
                className={cn(
                  "pressable h-8 flex-1 rounded-full px-3 text-[0.8125rem] font-semibold transition-colors duration-150",
                  on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <ToggleRow label="Capital letters" checked={el.upper} onChange={(upper) => set({ upper })} />
      </Section>
      <Section title="Text">
        <FontField value={el.font} onChange={(font) => set({ font })} />
        <SliderField label="Digit height" value={el.size} min={12} max={120} unit="px" onChange={(size) => set({ size })} />
        <ColorField label="Color" value={el.color} onChange={(color) => set({ color })} />
        <OutlineField value={el.outline} onChange={(outline) => set({ outline })} fallback="#000000" />
        <SliderField label="Spacing" value={el.tracking} min={-4} max={30} unit="px" onChange={(tracking) => set({ tracking })} />
      </Section>
    </>
  );
}

function HandFields({ el, set }: { el: HandElement; set: Patch<HandElement> }) {
  const upload = async (file: File) => {
    try {
      const assetId = await addAssetFromFile(file, "sprite");
      const img = getAsset(assetId);
      set({
        shape: "custom",
        assetId,
        pivotX: Math.round((img?.width ?? 20) / 2),
        pivotY: Math.round((img?.height ?? 200) * 0.85),
        scale: 1,
      });
    } catch {
      toast.error("That file could not be read as an image.");
    }
  };
  return (
    <>
      <Section title="Hand">
        <SegmentedField
          label="Shows"
          value={el.hand}
          options={[
            { value: "hour", label: "Hour" },
            { value: "minute", label: "Minute" },
            { value: "second", label: "Second" },
          ]}
          onChange={(hand) => set({ hand, name: `${hand[0]!.toUpperCase()}${hand.slice(1)} hand` })}
        />
        <SegmentedField
          label="Shape"
          value={el.shape}
          options={[
            { value: "classic", label: "Classic" },
            { value: "baton", label: "Baton" },
            { value: "sword", label: "Sword" },
            { value: "needle", label: "Needle" },
            { value: "custom", label: "PNG" },
          ]}
          onChange={(shape) => set({ shape })}
        />
        {el.shape !== "custom" ? (
          <>
            <ColorField label="Color" value={el.color} onChange={(color) => set({ color })} />
            <SliderField label="Length" value={el.length} min={20} max={240} unit="px" onChange={(length) => set({ length })} />
            <SliderField label="Width" value={el.width} min={2} max={40} unit="px" onChange={(width) => set({ width })} />
            <SliderField label="Counterweight" value={el.tail} min={0} max={80} unit="px" onChange={(tail) => set({ tail })} />
          </>
        ) : (
          <>
            <UploadButton label={el.assetId ? "Replace PNG" : "Upload hand PNG"} accept="image/png" onFile={upload} />
            <p className="px-0.5 text-xs text-muted-foreground">Draw the hand pointing straight up (12 o'clock). Set the pivot where it turns.</p>
            {el.assetId && (
              <>
                <SliderField label="Scale" value={el.scale} min={0.2} max={2} step={0.01} unit="×" onChange={(scale) => set({ scale })} />
                <div className="grid grid-cols-2 gap-3">
                  <Row label="Pivot X">
                    <NumberInput label="Pivot X" value={el.pivotX} min={0} onChange={(pivotX) => set({ pivotX: Math.round(pivotX) })} />
                  </Row>
                  <Row label="Pivot Y">
                    <NumberInput label="Pivot Y" value={el.pivotY} min={0} onChange={(pivotY) => set({ pivotY: Math.round(pivotY) })} />
                  </Row>
                </div>
              </>
            )}
          </>
        )}
      </Section>
    </>
  );
}

function ImageFields({ el, set }: { el: ImageElement; set: Patch<ImageElement> }) {
  const [lock, setLock] = useState(true);
  const img = getAsset(el.assetId);
  const ratio = img ? img.width / img.height : el.w / Math.max(1, el.h);
  const upload = async (file: File) => {
    try {
      const assetId = await addAssetFromFile(file, "sprite");
      const loaded = getAsset(assetId);
      if (loaded) {
        const k = Math.min(1, 280 / Math.max(loaded.width, loaded.height));
        set({ assetId, w: Math.round(loaded.width * k), h: Math.round(loaded.height * k) });
      } else set({ assetId });
    } catch {
      toast.error("That file could not be read as an image.");
    }
  };
  return (
    <Section title="Image">
      <UploadButton label={el.assetId ? "Replace image" : "Upload image"} onFile={upload} />
      <ToggleRow label="Keep proportions" checked={lock} onChange={setLock} />
      <div className="grid grid-cols-2 gap-3">
        <Row label="Width">
          <NumberInput
            label="Width"
            value={el.w}
            min={4}
            max={1600}
            onChange={(w) => set(lock ? { w: Math.round(w), h: Math.max(1, Math.round(w / ratio)) } : { w: Math.round(w) })}
          />
        </Row>
        <Row label="Height">
          <NumberInput
            label="Height"
            value={el.h}
            min={4}
            max={1600}
            onChange={(h) => set(lock ? { h: Math.round(h), w: Math.max(1, Math.round(h * ratio)) } : { h: Math.round(h) })}
          />
        </Row>
      </div>
    </Section>
  );
}

function WidgetFields({ el, set }: { el: WidgetElement; set: Patch<WidgetElement> }) {
  return (
    <>
      <Section title="Data">
        <SegmentedField
          label="Shows"
          value={el.source}
          options={(Object.keys(WIDGET_LABELS) as Array<keyof typeof WIDGET_LABELS>).map((v) => ({
            value: v,
            label: v === "heartRate" ? "Heart" : WIDGET_LABELS[v],
          }))}
          onChange={(source) => {
            const fresh = newWidget(source);
            set({ source, name: fresh.name, iconColor: fresh.iconColor });
          }}
        />
      </Section>
      <Section title="Number">
        <FontField value={el.font} onChange={(font) => set({ font })} />
        <SliderField label="Digit height" value={el.size} min={14} max={120} unit="px" onChange={(size) => set({ size })} />
        <ColorField label="Color" value={el.color} onChange={(color) => set({ color })} />
        <OutlineField value={el.outline} onChange={(outline) => set({ outline })} fallback="#000000" />
        <SliderField label="Spacing" value={el.tracking} min={-4} max={20} unit="px" onChange={(tracking) => set({ tracking })} />
      </Section>
      <Section title="Icon">
        <ToggleRow label="Show icon" checked={el.showIcon} onChange={(showIcon) => set({ showIcon })} />
        {el.showIcon && (
          <>
            <ColorField label="Icon color" value={el.iconColor} onChange={(iconColor) => set({ iconColor })} />
            <SegmentedField
              label="Icon position"
              value={el.layout}
              options={[
                { value: "side", label: "Beside" },
                { value: "stack", label: "Above" },
              ]}
              onChange={(layout) => set({ layout })}
            />
          </>
        )}
      </Section>
    </>
  );
}

function RingFields({ el, set }: { el: RingElement; set: Patch<RingElement> }) {
  return (
    <Section title="Progress ring">
      <SegmentedField
        label="Shows"
        value={el.source}
        options={[
          { value: "steps", label: "Steps goal" },
          { value: "battery", label: "Battery" },
        ]}
        onChange={(source) => set({ source, name: source === "steps" ? "Steps ring" : "Battery ring" })}
      />
      <SliderField label="Diameter" value={el.size} min={48} max={480} unit="px" onChange={(size) => set({ size })} />
      <SliderField label="Thickness" value={el.thickness} min={2} max={60} unit="px" onChange={(thickness) => set({ thickness })} />
      <SliderField label="Start angle" value={el.startAngle} min={0} max={359} unit="°" onChange={(startAngle) => set({ startAngle })} />
      <SliderField label="Sweep" value={el.sweep} min={30} max={360} unit="°" onChange={(sweep) => set({ sweep })} />
      <ColorField label="Progress color" value={el.color} onChange={(color) => set({ color })} />
      <ColorField label="Track color" value={el.trackColor} onChange={(trackColor) => set({ trackColor })} />
      <ToggleRow label="Rounded ends" checked={el.roundCap} onChange={(roundCap) => set({ roundCap })} />
    </Section>
  );
}

export function PropertyPanel() {
  const el = useEditor((s) => s.project.elements.find((e) => e.id === s.selectedId) ?? null);
  const updateElement = useEditor((s) => s.updateElement);
  const removeElement = useEditor((s) => s.removeElement);
  const duplicateElement = useEditor((s) => s.duplicateElement);
  const moveInStack = useEditor((s) => s.moveInStack);
  const stackIndex = useEditor((s) => s.project.elements.findIndex((e) => e.id === s.selectedId));
  const stackSize = useEditor((s) => s.project.elements.length);

  if (!el) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-bold">Nothing selected</p>
        <p className="text-[0.8125rem] text-muted-foreground">Click an element on the preview or in the layers list to edit it.</p>
      </div>
    );
  }
  const set = ((patch: Partial<Element>) => updateElement(el.id, patch)) as Patch<Element>;
  const support = elementSupport(el);

  return (
    <div className="space-y-4 p-4" data-testid="properties">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Layer name"
          value={el.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
          className="h-9 min-w-0 flex-1 rounded-xl bg-muted px-3 text-sm font-bold"
        />
        {el.type !== "background" && (
          <>
            <Button variant="secondary" size="icon-sm" className="size-9" aria-label="Move layer up" title="Bring forward (Ctrl+])" disabled={stackIndex >= stackSize - 1} onClick={() => moveInStack(el.id, 1)}>
              <ChevronUp />
            </Button>
            <Button variant="secondary" size="icon-sm" className="size-9" aria-label="Move layer down" title="Send backward (Ctrl+[)" disabled={stackIndex <= 1} onClick={() => moveInStack(el.id, -1)}>
              <ChevronDown />
            </Button>
            <Button variant="secondary" size="icon-sm" className="size-9" aria-label="Duplicate layer" title="Duplicate (Ctrl+D)" onClick={() => duplicateElement(el.id)}>
              <Copy />
            </Button>
            <Button variant="destructive" size="icon-sm" className="size-9" aria-label="Delete layer" title="Delete (Del)" onClick={() => removeElement(el.id)}>
              <Trash2 />
            </Button>
          </>
        )}
      </div>
      <p className="px-0.5 text-xs font-semibold text-muted-foreground">{ELEMENT_LABELS[el.type]}</p>

      {support.level === "preview-only" && (
        <div className="flex gap-2.5 rounded-2xl bg-warning-soft p-3 text-[0.8125rem] text-foreground" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-bold">Preview only.</span> {support.note} It shows in the editor but is left out of the .hwt export.
          </p>
        </div>
      )}
      {support.level === "experimental" && (
        <div className="flex gap-2.5 rounded-2xl bg-warning-soft p-3 text-[0.8125rem] text-foreground" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-bold">Unconfirmed on a watch.</span> {support.note || support.experimental.join(", ")} Exported only when you keep
            unconfirmed elements on in the export dialog.
          </p>
        </div>
      )}
      {support.level !== "preview-only" && support.dropped.length > 0 && (
        <div className="flex gap-2.5 rounded-2xl bg-warning-soft p-3 text-[0.8125rem] text-foreground" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-bold">Preview only:</span> {support.dropped.join(", ")}. The rest of this element is exported.
          </p>
        </div>
      )}

      {el.type === "background" && <BackgroundFields el={el} set={set as Patch<BackgroundElement>} />}
      {el.type === "time" && <TimeFields el={el} set={set as Patch<TimeElement>} />}
      {el.type === "date" && <DateFields el={el} set={set as Patch<DateElement>} />}
      {el.type === "hand" && <HandFields el={el} set={set as Patch<HandElement>} />}
      {el.type === "image" && <ImageFields el={el} set={set as Patch<ImageElement>} />}
      {el.type === "widget" && <WidgetFields el={el} set={set as Patch<WidgetElement>} />}
      {el.type === "ring" && <RingFields el={el} set={set as Patch<RingElement>} />}
      {el.type !== "background" && <PositionFields el={el} set={set} pivot={el.type === "hand"} />}
    </div>
  );
}
