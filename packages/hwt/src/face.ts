/**
 * High-level construction of version 2 faces (the layout the Fit 4 Pro samples use) from RGBA images.
 *
 * ```ts
 * const pkg = createHwt({ title: "Mine", cover });
 * const face = new FaceBuilder(pkg.watchface!);
 * face.element("background", (e) => e.singleImage({ image: bg, x: 0, y: 0, ambient: "normal" }));
 * face.element("time", (e) => {
 *   e.digits({ digits: hourDigits, x: 20, y: 100, align: "right", valueType: VALUE_TYPE.hour, ambient: "both" });
 * });
 * face.commit();
 * const bytes = writeHwt(pkg);
 * ```
 *
 * Every builder method maps one-to-one onto a vendor schema message (`Single_Res`, `Hand_Res`, `Arc_Res`,
 * `Combined_Res`, `Selected_Res`, `Container`); field names in the options follow the schema. Which combinations the
 * firmware accepts is documented in README ("What a valid face needs") together with what is verified.
 */
import { HwtError, bytesEqual } from "./bytes";
import { buildMessage } from "./compose";
import { encodeImage, type RgbaImage } from "./image";
import { decodeLayout, encodeLayout, schemaFor, type Layout, type NamedObject, type NamedValue } from "./layout";
import { encodePb, type PbField } from "./protobuf";
import { assertEditable, imageRef, type WatchfaceBinary } from "./watchface";

export type ElementLabel = "background" | "time" | "date" | "widget" | "complication";
/**
 * `normal`: shown in the normal display only. `aod`: shown on the always-on display only. `both`: emitted twice, once per
 * mode — the way every sample does it (no sample uses the schema's AMBIENT_NORMAL value).
 */
export type Ambient = "normal" | "aod" | "both";
export type Align = "left" | "center" | "right";

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  width: number;
  height: number;
}

/** An image: pixels (encoded and registered for you), or a slot index / reference of an existing image. */
export type ImageInput = RgbaImage | number | string;

const LABELS: Record<ElementLabel, string> = {
  background: "ELEMENT_LABEL_BACKGROUND",
  time: "ELEMENT_LABEL_TIME",
  date: "ELEMENT_LABEL_DATE",
  widget: "ELEMENT_LABEL_WIDGET",
  complication: "ELEMENT_LABEL_COMPLICATION",
};
const ALIGN: Record<Align, string> = { left: "LEFT", center: "CENTER", right: "RIGHT" };
const AMBIENT_NORMAL = "NORMAL_ONLY";
const AMBIENT_AOD = "AMBIENT_ONLY";

export interface SingleImageOptions {
  image: ImageInput;
  x: number;
  y: number;
  ambient?: Ambient;
}

export interface HandOptions {
  image: ImageInput;
  /** `rotate_rect`: box in screen coordinates the hand rotates in. */
  rect: Rect;
  /** `rotate_point_hand`: the point of the hand image that sits on the rotation centre. */
  pivot: Point;
  /** Degrees (`rotate_start_angel` / `rotate_end_angel`; the schema's spelling). Time hands use 0 -> 360. */
  startAngle: number;
  endAngle: number;
  valueType: number;
  ambient?: Ambient;
}

export interface ArcOptions {
  image: ImageInput;
  /** `rect`: where the (full circle sized) arc image is drawn; may start off screen (negative). */
  rect: Rect;
  /** `center_point`: centre of the arc inside the image. */
  center: Point;
  radius: number;
  lineWidth: number;
  startAngle: number;
  endAngle: number;
  valueType: number;
  /** `cap_type`: ROUND or NONE. Omitted = field absent (as in every sample). */
  cap?: "round" | "none";
  ambient?: Ambient;
}

export interface DigitsOptions {
  /** Exactly 10 images, digit 0 to 9. */
  digits: readonly ImageInput[];
  x: number;
  y: number;
  align: Align;
  valueType: number;
  /** `res_sign`: image shown with the number (degree sign, percent, minus...). Empty when omitted. */
  sign?: ImageInput;
  /** `x_offset` / `y_offset` (int32), default 0. */
  xOffset?: number;
  yOffset?: number;
  ambient?: Ambient;
}

export interface SelectedOptions {
  /** `images[v]` is shown when the value is `v`. `null` leaves that value without an image. Length must suit the value type (see VALUE_TYPES.imageCount). */
  images: readonly (ImageInput | null)[];
  x: number;
  y: number;
  valueType: number;
  ambient?: Ambient;
}

export interface ElementOptions {
  /** `res_preview`: an image shown as this element's preview in the watch's customisation UI (backgrounds in the samples). */
  preview?: ImageInput;
  /** `bottom` inserts before every existing element (drawn first, behind them). Default: after the last element. */
  position?: "bottom" | "top";
}

export interface ContainerOptions {
  /** Widget slot type, see `WIDGET_DATA_TYPE`. */
  dataType?: number;
  rect?: Rect;
}

function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${h.toString(16)}`;
}

export class FaceBuilder {
  readonly wf: WatchfaceBinary;
  private readonly layout: Layout;
  private readonly known = new Map<string, number>();

  constructor(wf: WatchfaceBinary) {
    assertEditable(wf);
    if (wf.version < 2) throw new HwtError("FaceBuilder builds version 2 layouts; this watchface binary is version 1");
    this.wf = wf;
    this.layout = decodeLayout(wf.layout, wf.version);
    wf.images.forEach((blob, i) => {
      if (blob.length) this.known.set(fnv(blob), i);
    });
  }

  /** Registers an image (identical encoded images share one slot) and returns its layout reference. */
  image(input: ImageInput): string {
    if (typeof input === "string") return this.refOf(Number(input) - 1, input);
    if (typeof input === "number") return this.refOf(input, String(input));
    const blob = encodeImage(input);
    const key = fnv(blob);
    const hit = this.known.get(key);
    if (hit !== undefined && bytesEqual(this.wf.images[hit]!, blob)) return imageRef(hit);
    this.wf.images.push(blob);
    this.known.set(key, this.wf.images.length - 1);
    return imageRef(this.wf.images.length - 1);
  }

  private refOf(index: number, shown: string): string {
    if (!Number.isInteger(index) || index < 0 || index >= this.wf.images.length || this.wf.images[index]!.length === 0) {
      throw new HwtError(`image ${shown} does not name an existing slot`);
    }
    return imageRef(index);
  }

  /** Adds an element; `build` receives the layer builder for it. */
  element(label: ElementLabel, build: (e: ElementBuilder) => void, options: ElementOptions = {}): void {
    const eb = new ElementBuilder(this);
    build(eb);
    const named: NamedObject = { label: LABELS[label], is_support_option: false };
    // Samples: BACKGROUND/TIME/DATE elements always carry res_preview (empty unless set); WIDGET elements never do.
    if (options.preview !== undefined) named.res_preview = this.image(options.preview);
    else if (label !== "widget") named.res_preview = "";
    const layers = eb.layersNamed();
    const containers = eb.containersNamed();
    if (layers.length) named.layer = layers;
    if (containers.length) named.container = containers;
    const { schema } = schemaFor("v2");
    const message = buildMessage(schema, "Element", named);
    const field: PbField = { field: 1, wire: 2, bytes: encodePb(message), message };
    const fields = this.layout.root.fields;
    if (options.position === "bottom") {
      fields.unshift(field);
      return;
    }
    let at = 0;
    fields.forEach((f, i) => {
      if (f.field === 1) at = i + 1;
    });
    fields.splice(at, 0, field);
  }

  /** Writes the layout back into the watchface binary. Call once after the last `element`. */
  commit(): void {
    this.wf.layout = encodeLayout(this.layout);
  }
}

interface LayerSpec {
  drawType: string;
  key: string;
  body: (ambientMode: string) => NamedObject;
  normal: boolean;
  aod: boolean;
}

interface ContainerSpec {
  options: ContainerOptions;
  inner: ElementBuilder;
}

function toLayers(specs: readonly LayerSpec[], mode: string, firstIndex: number): NamedObject[] {
  return specs.map((s, i) => ({ index: firstIndex + i, draw_type: s.drawType, [s.key]: s.body(mode) }));
}

/**
 * Collects the layers of one element (or container) and lays them out the way the Fit 4 Pro samples do:
 *
 * - normal-mode layers first, numbered 0..n-1; always-on layers after them, numbered from n+1 (the samples skip one number);
 * - a container's always-on layers go into a **separate container** with the same `data_type`, no `rect`, and an index one
 *   past the last normal container (every sample's AOD containers share that index).
 */
export class ElementBuilder {
  private readonly specs: LayerSpec[] = [];
  private readonly containerSpecs: ContainerSpec[] = [];

  constructor(private readonly face: FaceBuilder) {}

  private push(drawType: string, key: string, body: (ambientMode: string) => NamedObject, ambient: Ambient | undefined): void {
    this.specs.push({ drawType, key, body, normal: ambient !== "aod", aod: ambient === "aod" || ambient === "both" });
  }

  /** Layers of this element in file order. */
  layersNamed(): NamedObject[] {
    const normal = this.specs.filter((s) => s.normal);
    const aod = this.specs.filter((s) => s.aod);
    return [...toLayers(normal, AMBIENT_NORMAL, 0), ...toLayers(aod, AMBIENT_AOD, normal.length ? normal.length + 1 : 0)];
  }

  /** Containers of this element in file order: all normal containers, then the always-on ones. */
  containersNamed(): NamedObject[] {
    const out: NamedObject[] = [];
    const withNormal = this.containerSpecs.filter((c) => c.inner.specs.some((s) => s.normal));
    withNormal.forEach((c, i) => {
      const body: NamedObject = { index: i, is_support_option: false };
      if (c.options.rect) body.rect = { ...c.options.rect };
      body.layer = toLayers(
        c.inner.specs.filter((s) => s.normal),
        AMBIENT_NORMAL,
        0,
      );
      if (c.options.dataType !== undefined) body.data_type = c.options.dataType;
      out.push(body);
    });
    const aodIndex = withNormal.length ? withNormal.length + 1 : 0;
    for (const c of this.containerSpecs) {
      const aod = c.inner.specs.filter((s) => s.aod);
      if (!aod.length) continue;
      const body: NamedObject = { index: aodIndex, is_support_option: false, layer: toLayers(aod, AMBIENT_AOD, 0) };
      if (c.options.dataType !== undefined) body.data_type = c.options.dataType;
      out.push(body);
    }
    return out;
  }

  singleImage(o: SingleImageOptions): void {
    const ref = this.face.image(o.image);
    this.push("DRAW_TYPE_SINGLE_RES", "single_res", (ambient_mode) => ({ res_name: ref, res_position: { x: o.x, y: o.y }, ambient_mode }), o.ambient);
  }

  hand(o: HandOptions): void {
    const ref = this.face.image(o.image);
    this.push(
      "DRAW_TYPE_HAND_RES",
      "hand_res",
      (ambient_mode) => ({
        res_name: ref,
        rotate_rect: { ...o.rect },
        rotate_point_hand: { ...o.pivot },
        rotate_start_angel: o.startAngle,
        rotate_end_angel: o.endAngle,
        value_type: o.valueType,
        ambient_mode,
      }),
      o.ambient,
    );
  }

  arc(o: ArcOptions): void {
    const ref = this.face.image(o.image);
    this.push(
      "DRAW_TYPE_ARC_RES",
      "arc_res",
      (ambient_mode) => {
        const body: NamedObject = {
          res_name: ref,
          rect: { ...o.rect },
          center_point: { ...o.center },
          radius: o.radius,
          line_width: o.lineWidth,
          start_angle: o.startAngle,
          end_angle: o.endAngle,
          value_type: o.valueType,
          ambient_mode,
        };
        if (o.cap) body.cap_type = o.cap === "round" ? "ROUND" : "NONE";
        return body;
      },
      o.ambient,
    );
  }

  digits(o: DigitsOptions): void {
    if (o.digits.length !== 10) throw new HwtError(`digits needs 10 images (0-9), got ${o.digits.length}`);
    const refs = o.digits.map((d) => this.face.image(d));
    const sign = o.sign === undefined ? "" : this.face.image(o.sign);
    this.push(
      "DRAW_TYPE_COMBINED_RES",
      "combined_res",
      (ambient_mode) => ({
        res_name: refs,
        res_default: [""],
        res_position: { x: o.x, y: o.y },
        res_align: ALIGN[o.align],
        value_type: o.valueType,
        res_sign: sign,
        x_offset: o.xOffset ?? 0,
        y_offset: o.yOffset ?? 0,
        ambient_mode,
      }),
      o.ambient,
    );
  }

  selected(o: SelectedOptions): void {
    const refs: NamedValue[] = o.images.map((img) => (img === null ? "" : this.face.image(img)));
    this.push(
      "DRAW_TYPE_SELECTED_RES",
      "selected_res",
      (ambient_mode) => ({ res_name: refs, res_position: { x: o.x, y: o.y }, value_type: o.valueType, ambient_mode }),
      o.ambient,
    );
  }

  /** A container groups the layers of one widget slot (every widget layer of every sample sits in one). Only meaningful for `widget` elements. */
  container(build: (e: ElementBuilder) => void, options: ContainerOptions = {}): void {
    const inner = new ElementBuilder(this.face);
    build(inner);
    this.containerSpecs.push({ options, inner });
  }
}
