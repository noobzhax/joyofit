/**
 * Layout schema for `version 1` watch faces, reverse engineered from the three samples in fixtures/ that use it
 * (Carrera, SimpleItalic, Unnamed). Unlike {@link SCHEMA_V2} there is no vendor schema behind this; every name is an
 * interpretation with the evidence recorded in README.md ("Version 1 layout"). Fields that no sample explains are
 * deliberately absent and therefore survive as raw unknown fields.
 *
 * The root message is a repeating triple `element (1), title_en (2), title_cn (3)` — the title strings follow every
 * element instead of appearing once — so the root's `titleEn`/`titleCn` fields are expected to be repeated.
 */
import type { PbSchema } from "./protobuf";

export const ELEMENT_V1_STATIC = 0;
export const ELEMENT_V1_HAND = 1;
export const ELEMENT_V1_TEXT = 3;
export const ELEMENT_V1_GLYPHS = 6;

export const SCHEMA_V1: PbSchema = {
  messages: {
    Root: {
      fields: {
        1: { name: "element", kind: "message", message: "Element", repeated: true },
        2: { name: "title_en", kind: "string", repeated: true },
        3: { name: "title_cn", kind: "string", repeated: true },
      },
    },
    Element: {
      fields: {
        1: { name: "type", kind: "varint" },
        2: { name: "static_image", kind: "message", message: "StaticImage" },
        3: { name: "hand", kind: "message", message: "Hand" },
        5: { name: "text", kind: "message", message: "Text" },
        8: { name: "glyphs", kind: "message", message: "Glyphs" },
      },
    },
    StaticImage: {
      fields: {
        1: { name: "image", kind: "string" },
        2: { name: "x", kind: "varint" },
        3: { name: "y", kind: "varint" },
      },
    },
    Hand: {
      fields: {
        1: { name: "image", kind: "string" },
        2: { name: "rect_x", kind: "varint" },
        3: { name: "rect_y", kind: "varint" },
        4: { name: "rect_width", kind: "varint" },
        5: { name: "rect_height", kind: "varint" },
        6: { name: "pivot_x", kind: "varint" },
        7: { name: "pivot_y", kind: "varint" },
        8: { name: "start_angle", kind: "float" },
        9: { name: "end_angle", kind: "float" },
        10: { name: "value_type", kind: "varint" },
      },
    },
    Text: {
      fields: {
        1: { name: "rect_x", kind: "varint" },
        2: { name: "rect_y", kind: "varint" },
        3: { name: "rect_width", kind: "varint" },
        4: { name: "rect_height", kind: "varint" },
        5: { name: "red", kind: "varint" },
        6: { name: "green", kind: "varint" },
        7: { name: "blue", kind: "varint" },
        8: { name: "font", kind: "varint" },
        9: { name: "align", kind: "varint" },
        11: { name: "value_type", kind: "varint" },
        12: { name: "alpha", kind: "varint" },
      },
    },
    Glyphs: {
      fields: {
        1: { name: "x", kind: "varint" },
        2: { name: "y", kind: "varint" },
        3: { name: "value_type", kind: "varint" },
        10: { name: "glyph_table", kind: "message", message: "GlyphTable" },
      },
    },
    GlyphTable: {
      fields: Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [i + 1, { name: `value_${i}`, kind: "string" as const }]),
      ),
    },
  },
  enums: {},
};
