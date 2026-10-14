import { useState } from "react";
import {
  BatteryFull,
  CalendarDays,
  CircleDashed,
  Clock,
  Eye,
  EyeOff,
  Flame,
  Footprints,
  Heart,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Paintbrush,
  Plus,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { newHand, newRing, newWidget, newDate, newImage, newTime } from "@/model/defaults";
import type { Element, WidgetSource } from "@/model/types";
import { elementSupport } from "@/export/support";
import { cn } from "@/ui/utils";
import { useEditor } from "./store";

interface Look {
  icon: LucideIcon;
  /** Tailwind classes for the chip: background tint and icon color. */
  chip: string;
}

const NEUTRAL = "bg-muted text-muted-foreground";
const WIDGET_LOOK: Record<WidgetSource, Look> = {
  steps: { icon: Footprints, chip: "bg-steps-soft text-steps-ink" },
  heartRate: { icon: Heart, chip: "bg-heart-soft text-heart-ink" },
  battery: { icon: BatteryFull, chip: "bg-battery-soft text-battery-ink" },
  calories: { icon: Flame, chip: "bg-calories-soft text-calories-ink" },
};

function lookOf(el: Element): Look {
  switch (el.type) {
    case "background":
      return { icon: Paintbrush, chip: NEUTRAL };
    case "time":
      return { icon: Clock, chip: NEUTRAL };
    case "date":
      return { icon: CalendarDays, chip: NEUTRAL };
    case "hand":
      return { icon: Timer, chip: NEUTRAL };
    case "image":
      return { icon: ImageIcon, chip: NEUTRAL };
    case "widget":
      return WIDGET_LOOK[el.source];
    case "ring":
      return { icon: CircleDashed, chip: el.source === "steps" ? WIDGET_LOOK.steps.chip : WIDGET_LOOK.battery.chip };
  }
}

interface AddAction {
  /** Full name for assistive tech; `short` is shown, because the group heading already gives context. */
  label: string;
  short: string;
  icon: LucideIcon;
  chip: string;
  make: () => Element[];
}

const ADD_GROUPS: Array<{ title: string; actions: AddAction[] }> = [
  {
    title: "Time and date",
    actions: [
      { label: "Digital time", short: "Time", icon: Clock, chip: NEUTRAL, make: () => [newTime()] },
      { label: "Date", short: "Date", icon: CalendarDays, chip: NEUTRAL, make: () => [newDate()] },
    ],
  },
  {
    title: "Analog hands",
    actions: [
      { label: "Hour hand", short: "Hour", icon: Timer, chip: NEUTRAL, make: () => [newHand("hour")] },
      { label: "Minute hand", short: "Minute", icon: Timer, chip: NEUTRAL, make: () => [newHand("minute")] },
      { label: "Second hand", short: "Second", icon: Timer, chip: NEUTRAL, make: () => [newHand("second")] },
    ],
  },
  {
    title: "Data",
    actions: (Object.keys(WIDGET_LOOK) as WidgetSource[]).map((source) => ({
      label: newWidget(source).name,
      short: source === "heartRate" ? "Heart" : newWidget(source).name,
      icon: WIDGET_LOOK[source].icon,
      chip: WIDGET_LOOK[source].chip,
      make: () => [newWidget(source)],
    })),
  },
  {
    title: "Rings and images",
    actions: [
      { label: "Steps ring", short: "Steps ring", icon: CircleDashed, chip: WIDGET_LOOK.steps.chip, make: () => [newRing("steps")] },
      { label: "Battery ring", short: "Battery ring", icon: CircleDashed, chip: WIDGET_LOOK.battery.chip, make: () => [newRing("battery", { size: 120, thickness: 10, x: 24, y: 24 })] },
      { label: "Image or sticker", short: "Image", icon: ImageIcon, chip: NEUTRAL, make: () => [newImage(null, 120, 120)] },
    ],
  },
];

export function AddElements() {
  const addCustom = useEditor((s) => s.addCustom);
  return (
    <div className="space-y-3" data-testid="add-elements">
      {ADD_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-1 text-xs font-semibold text-muted-foreground">{group.title}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {group.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                aria-label={a.label}
                title={a.label}
                onClick={() => a.make().forEach(addCustom)}
                className="pressable flex min-h-10 items-center gap-2 rounded-xl bg-muted px-2.5 text-left text-[0.8125rem] font-semibold transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-lg", a.chip)}>
                  <a.icon className="size-3.5" strokeWidth={2} />
                </span>
                <span className="truncate">{a.short}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IconToggle({ on, onLabel, offLabel, onIcon: On, offIcon: Off, onClick, active }: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onIcon: LucideIcon;
  offIcon: LucideIcon;
  onClick: () => void;
  /** Highlight the "off" state: a hidden or locked layer is a state worth seeing. */
  active: boolean;
}) {
  const Icon = on ? On : Off;
  return (
    <button
      type="button"
      aria-label={on ? onLabel : offLabel}
      title={on ? onLabel : offLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-150 hover:bg-foreground/8 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        active ? "text-foreground" : "text-muted-foreground/70",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function LayerPanel() {
  const elements = useEditor((s) => s.project.elements);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const updateElement = useEditor((s) => s.updateElement);
  const reorder = useEditor((s) => s.reorder);
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Top of the list is the top of the stack.
  const rows = [...elements].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-base font-bold tracking-tight">Layers</h2>
        <button
          type="button"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
          className="pressable flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[0.8125rem] font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Plus className={cn("size-4 transition-transform duration-200", adding && "rotate-45")} />
          Add
        </button>
      </div>

      {adding && (
        <div className="panel-scroll mx-3 mb-2 max-h-[60%] shrink-0 overflow-y-auto rounded-2xl bg-card p-3 ring-1 ring-border">
          <AddElements />
        </div>
      )}

      <ul className="panel-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3" data-testid="layers">
        {rows.map((el) => {
          const look = lookOf(el);
          const index = elements.indexOf(el);
          const selected = el.id === selectedId;
          const level = elementSupport(el).level;
          return (
            <li
              key={el.id}
              draggable={el.type !== "background"}
              onDragStart={() => setDragId(el.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                if (dragId && el.type !== "background") {
                  e.preventDefault();
                  setOverId(el.id);
                }
              }}
              onDrop={() => {
                if (dragId && dragId !== el.id) reorder(dragId, index);
                setDragId(null);
                setOverId(null);
              }}
              className={cn("rounded-2xl transition-shadow duration-150", overId === el.id && dragId !== el.id && "ring-2 ring-primary/60")}
            >
              <div
                role="button"
                tabIndex={0}
                data-testid={`layer-${el.type}`}
                aria-pressed={selected}
                onClick={() => select(el.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(el.id);
                  }
                }}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                  selected ? "bg-primary/10" : "hover:bg-foreground/5",
                  !el.visible && "opacity-55",
                )}
              >
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", look.chip)}>
                  <look.icon className="size-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{el.name}</span>
                  {level !== "verified" && (
                    <span className="block text-[0.6875rem] font-semibold text-warning">
                      {level === "preview-only" ? "Preview only" : "Unconfirmed"}
                    </span>
                  )}
                </span>
                <IconToggle
                  on={el.visible}
                  onLabel="Hide layer"
                  offLabel="Show layer"
                  onIcon={Eye}
                  offIcon={EyeOff}
                  active={!el.visible}
                  onClick={() => updateElement(el.id, { visible: !el.visible })}
                />
                <IconToggle
                  on={el.locked}
                  onLabel="Unlock layer"
                  offLabel="Lock layer"
                  onIcon={Lock}
                  offIcon={LockOpen}
                  active={el.locked}
                  onClick={() => updateElement(el.id, { locked: !el.locked })}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
