/**
 * Editable watch faces: the options a face that is already on the watch exposes (style, background, colour, widgets).
 * Wire layout and what was verified: protocol/README.md, "Editing a face's options".
 */

/** The edit modes of Huawei Health's `DIAL_EDIT_MODE_*`. */
export const FACE_EDIT_MODES = {
  style: 0,
  background: 1,
  dual: 2,
  scale: 3,
  symbol: 4,
  typeface: 5,
  time: 6,
  hand: 7,
} as const;

export type FaceEditModeName = keyof typeof FACE_EDIT_MODES;

/** The selected option of one edit mode. `index` is the option's position in the face; the watch does not say how many there are. */
export interface FaceStyleChoice {
  /** One of `FACE_EDIT_MODES`. */
  mode: number;
  index: number;
}

/**
 * A face's configuration. Every part is optional: the watch reports only what the face exposes, and an apply changes only what it contains.
 * Every index is a position (0-based); the watch does not report names or counts.
 */
export interface FaceCustomization {
  /** The face's id, as in `WatchfaceInfo.id`. */
  marketId: string;
  /** Modes the face exposes with the selected option of each. */
  styles: FaceStyleChoice[];
  /** Index into the face's colour palette; null when the face has none. */
  colourIndex: number | null;
  /** A free colour string (Huawei Health sends `#RRGGBB`-style text); null when the face has none or none is set. */
  customColour: string | null;
  /** The selected option of each widget slot, slot = position. Empty when the face has no widget slots. */
  widgets: number[];
}

/** What `applyFaceCustomization` resolves with. */
export interface FaceApplyResult {
  /** The watch's read-back shows every requested part. */
  ok: boolean;
  /** The watch pushed its own report right after the apply. */
  echoed: boolean;
  /** Requested parts the read-back does not show. */
  mismatches: string[];
  /** One sentence describing the outcome. */
  message: string;
  /** The configuration read back after the apply; null when the watch did not answer. */
  config: FaceCustomization | null;
}
