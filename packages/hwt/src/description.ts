/**
 * `description.xml` model and the theme-version (screen code) table.
 *
 * The XML is only ever touched through targeted text patches, so a description whose fields were not edited is written
 * back unchanged. No DOM is used: the document is a flat `<HwTheme>` with one text element per field.
 */
import { HwtError } from "./bytes";

export interface Resolution {
  /** Screen code as it appears in `<screen>`, e.g. `HWHD13`. */
  code: string;
  /** Pixel height and width, in Gadgetbridge's "height*width" order. */
  height: number;
  width: number;
}

/** Gadgetbridge `HuaweiWatchfaceManager.Resolution` (identical to JoyoFit's WatchfaceResolutions). */
export const RESOLUTIONS: Record<string, Resolution> = Object.fromEntries(
  (
    [
      ["HWHD01", 390, 390],
      ["HWHD02", 454, 454],
      ["HWHD03", 240, 120],
      ["HWHD04", 160, 80],
      ["HWHD05", 460, 188],
      ["HWHD06", 456, 280],
      ["HWHD07", 368, 194],
      ["HWHD08", 320, 320],
      ["HWHD09", 466, 466],
      ["HWHD10", 360, 320],
      ["HWHD11", 480, 336],
      ["HWHD12", 240, 240],
      ["HWHD13", 480, 408],
      ["HWHD14", 482, 286],
      ["HNHD01", 466, 466],
      ["HNHD02", 368, 194],
      ["HNHD03", 450, 390],
      ["HNHD04", 454, 454],
      ["HNHD05", 402, 256],
      ["QXHD01", 402, 256],
      ["QXHD02", 502, 410],
    ] as const
  ).map(([code, height, width]) => [code, { code, height, width }]),
);

/** Watch Fit 3/4/4 Pro/5: 408 x 480 (width x height). */
export const FIT4_SCREEN = "HWHD13";

export interface HwtDescription {
  /** Root element: `HwTheme` (Huawei) or `HnTheme` (Honor). */
  root: "HwTheme" | "HnTheme";
  title: string;
  titleCn: string;
  author: string;
  designer: string;
  /** Theme version code / screen, e.g. `HWHD13`. */
  screen: string;
  /** `x.y.z`: GUI generation, capability level, package revision. See README. */
  version: string;
  font: string;
  fontCn: string;
  /** Free text; the samples use a JSON string such as `{}` or `{"en_US":"…"}`. */
  briefinfo: string;
}

const FIELD_TAGS: readonly (readonly [keyof Omit<HwtDescription, "root">, string])[] = [
  ["title", "title"],
  ["titleCn", "title-cn"],
  ["author", "author"],
  ["designer", "designer"],
  ["screen", "screen"],
  ["version", "version"],
  ["font", "font"],
  ["fontCn", "font-cn"],
  ["briefinfo", "briefinfo"],
];

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** Escapes the characters that must not appear raw in element text. Quotes are left alone, like the vendor tool does. */
function encodeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tagPattern(tag: string): RegExp {
  return new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}>)`);
}

function readField(xml: string, tag: string): string {
  const m = tagPattern(tag).exec(xml);
  return m && m[1] !== undefined ? decodeEntities(m[1]).trim() : "";
}

/** Parses `description.xml` text (a leading BOM is ignored). Throws if the root is not HwTheme/HnTheme or `<screen>` is missing. */
export function parseDescription(xml: string): HwtDescription {
  const text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const rootMatch = /<(HwTheme|HnTheme)[\s>]/.exec(text);
  if (!rootMatch) throw new HwtError("description.xml: root element is neither HwTheme nor HnTheme");
  const d: HwtDescription = {
    root: rootMatch[1] as "HwTheme" | "HnTheme",
    title: "",
    titleCn: "",
    author: "",
    designer: "",
    screen: "",
    version: "",
    font: "",
    fontCn: "",
    briefinfo: "",
  };
  for (const [key, tag] of FIELD_TAGS) d[key] = readField(text, tag);
  if (!d.screen) throw new HwtError("description.xml names no <screen>");
  return d;
}

/** Renders a description in the exact layout the vendor tool writes (verified byte-identical against the Fit 4 Pro samples). */
export function renderDescription(d: HwtDescription): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<${d.root}>`];
  for (const [key, tag] of FIELD_TAGS) lines.push(`  <${tag}>${encodeText(d[key])}</${tag}>`);
  lines.push(`</${d.root}>`);
  return lines.join("\n");
}

/**
 * Applies `d` onto an existing `description.xml`: only fields whose value differs from what the XML says are rewritten
 * (self-closing elements such as `<author/>` are expanded), everything else keeps its original text and formatting.
 */
export function patchDescription(xml: string, d: HwtDescription): string {
  const current = parseDescription(xml);
  let out = xml;
  for (const [key, tag] of FIELD_TAGS) {
    if (current[key] === d[key]) continue;
    const element = `<${tag}>${encodeText(d[key])}</${tag}>`;
    const re = tagPattern(tag);
    if (re.test(out)) out = out.replace(re, () => element);
    else out = out.replace(new RegExp(`</${current.root}>`), () => `  ${element}\n</${current.root}>`);
  }
  return out;
}
