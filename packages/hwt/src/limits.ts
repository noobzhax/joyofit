/**
 * Size limits for 408 x 480 (HWHD13) version 2.y.z faces, from Huawei's "Verifications" page for Theme Studio Pro
 * (https://developer.huawei.com/consumer/en/doc/content/constraints-pro-0000001633566545). They are the limits Huawei's
 * own tool enforces before export; whether the watch or Gadgetbridge enforces the same numbers when sideloading is not
 * established. The layer-size model below follows the page's formulas but has not been checked against Theme Studio Pro's
 * own number for any face, so treat `layerBytes` as an estimate.
 */
import { IMAGE_HEADER_SIZE, readImageHeader } from "./image";
import { decodeLayout, describeLayout, usedImageIndices, type NamedObject } from "./layout";
import type { WatchfaceBinary } from "./watchface";

const MB = 1024 * 1024;

export const FIT4_LIMITS = {
  /** `watchface.bin`: "Max. Resource Package Size 9.5 MB". */
  maxBinaryBytes: 9.5 * MB,
  /** Whole `.hwt`: "Max. HWT Package Size 10 MB". */
  maxHwtBytes: 10 * MB,
  /** One image after compression: "Max. Single Image Pixel Size 750 KB". */
  maxImageBytes: 750 * 1024,
  /** Sum of w*h*4 of the images used: "Max. Size Allowed in PSRAM 4 MB". */
  maxImageMemoryBytes: 4 * MB,
  /** Layer model: "Max. Total Layer Size 25 KB (25,600 bytes)". */
  maxLayerBytes: 25_600,
} as const;

/** Per-control byte costs of the layer model (Verifications page, "Calculation Method"). */
const CONTROL_BYTES: Record<string, number> = {
  DRAW_TYPE_TEXT: 144,
  DRAW_TYPE_TEXT2_RES: 156,
  DRAW_TYPE_ARC_TEXT: 156,
  DRAW_TYPE_SINGLE_RES: 196,
  DRAW_TYPE_SELECTED_RES: 268,
  DRAW_TYPE_COMBINED_RES: 1252,
  DRAW_TYPE_HAND_RES: 452,
  DRAW_TYPE_LINE_RES: 136,
  DRAW_TYPE_ARC_RES: 148,
  DRAW_TYPE_ORDERED_RES: 340,
  DRAW_TYPE_SELECTED_ORDERED_RES: 368,
};
const FRAMEWORK = 2092;
const ELEMENT = 304;
const COMMON_CONTAINER = 268;
const CUSTOM_CONTAINER = 292;
const LAYER = 256;
const IMAGE_TABLE_ENTRY = 20;

export interface LimitReport {
  ok: boolean;
  /** Violations of limits that Huawei's tool enforces for sure (image size, package size, image memory). */
  problems: string[];
  /** The layer-size model, which is an unverified estimate. */
  warnings: string[];
  binaryBytes: number;
  hwtBytes?: number;
  largestImageBytes: number;
  imageMemoryBytes: number;
  layerBytes: number;
}

function layerCost(layer: NamedObject): number {
  const type = String(layer.draw_type);
  return LAYER + (CONTROL_BYTES[type] ?? 0);
}

function asList(value: unknown): NamedObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is NamedObject => typeof v === "object" && v !== null && !Array.isArray(v));
}

/** Estimated "total layer size" of a v2 layout, see file header. */
export function estimateLayerBytes(wf: WatchfaceBinary): number {
  const layout = decodeLayout(wf.layout, wf.version);
  if (layout.kind !== "v2") return 0;
  const named = describeLayout(layout);
  let total = 0;
  let hasContainer = false;
  for (const element of asList(named.element)) {
    total += ELEMENT;
    for (const layer of asList(element.layer)) total += layerCost(layer);
    for (const container of asList(element.container)) {
      hasContainer = true;
      total += container.is_support_option === true ? CUSTOM_CONTAINER : COMMON_CONTAINER;
      for (const layer of asList(container.layer)) total += layerCost(layer);
    }
  }
  if (hasContainer) total += FRAMEWORK;
  total += usedImageIndices(layout).length * IMAGE_TABLE_ENTRY;
  return total;
}

/** Checks a face against the 408 x 480 limits. `hwtBytes` (the serialised package size) is checked when given. */
export function checkFit4Limits(wf: WatchfaceBinary, binaryBytes: number, hwtBytes?: number): LimitReport {
  const problems: string[] = [];
  const layout = decodeLayout(wf.layout, wf.version);
  let largest = 0;
  wf.images.forEach((blob, i) => {
    if (blob.length > FIT4_LIMITS.maxImageBytes) problems.push(`image ${i}: ${blob.length} bytes encoded exceeds ${FIT4_LIMITS.maxImageBytes}`);
    largest = Math.max(largest, blob.length);
  });
  let memory = 0;
  for (const index of usedImageIndices(layout)) {
    const blob = wf.images[index];
    if (!blob || blob.length < IMAGE_HEADER_SIZE) continue;
    const h = readImageHeader(blob);
    memory += h.width * h.height * 4;
  }
  const layerBytes = estimateLayerBytes(wf);
  if (binaryBytes > FIT4_LIMITS.maxBinaryBytes) problems.push(`watchface binary is ${binaryBytes} bytes, limit ${FIT4_LIMITS.maxBinaryBytes}`);
  if (hwtBytes !== undefined && hwtBytes > FIT4_LIMITS.maxHwtBytes) problems.push(`package is ${hwtBytes} bytes, limit ${FIT4_LIMITS.maxHwtBytes}`);
  if (memory > FIT4_LIMITS.maxImageMemoryBytes) problems.push(`images need ${memory} bytes of image memory, limit ${FIT4_LIMITS.maxImageMemoryBytes}`);
  const warnings: string[] = [];
  if (layerBytes > FIT4_LIMITS.maxLayerBytes) {
    warnings.push(`estimated layer size ${layerBytes} exceeds ${FIT4_LIMITS.maxLayerBytes} (the estimate is unverified; several Fit 4 Pro samples exceed it)`);
  }
  return { ok: problems.length === 0, problems, warnings, binaryBytes, hwtBytes, largestImageBytes: largest, imageMemoryBytes: memory, layerBytes };
}
