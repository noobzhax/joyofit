/**
 * `value_type` ids: which live data a layer shows. The ids are numbers in the binary; Huawei documents the *names* of the
 * data types (https://developer.huawei.com/consumer/en/doc/content/value-type-pro-0000001583966586) but not the ids,
 * so every id here was reconstructed from the samples, and each entry says how sure that is:
 *
 * - `verified`: the sample's own preview picture (screen.jpg/cover.jpg) shows the value this id is bound to AND the layer
 *   structure (image count, container role) agrees.
 * - `inferred`: structure only (image counts match the value's range, container role, or the docs' ordering); no preview
 *   shows it. Treat as a strong hypothesis, not a fact: export only after confirming on a real watch.
 * - `unknown`: seen in samples, meaning not established. Listed so you do not re-investigate them.
 *
 * Everything not in this table (the docs list ~150 data types) has no known id. Obtain further ids by exporting faces
 * from Theme Studio Pro and diffing (README, "Open questions").
 */

export type DataCategory = "raw" | "enum" | "ratio" | "text";
export type Evidence = "verified" | "inferred" | "unknown";

export interface ValueTypeInfo {
  id: number;
  /** Docs name (Data Types page) where there is one. */
  name: string;
  category: DataCategory;
  evidence: Evidence;
  /** Number of images a Selected_Res/enum needs (index = value) when `category === "enum"`. */
  imageCount?: number;
  /** What the evidence is. */
  note: string;
}

export const VALUE_TYPES: readonly ValueTypeInfo[] = [
  { id: 12, name: "Hour", category: "raw", evidence: "verified", note: "Combined_Res in the TIME element of 14 Fit 4 Pro/GT/Band faces; SpaceRed preview shows 10:08 with 12 = left pair." },
  { id: 13, name: "Minute", category: "raw", evidence: "verified", note: "Combined_Res next to 12 in the same element; right pair of the clock." },
  { id: 17, name: "Date", category: "raw", evidence: "verified", note: "Combined_Res in DATE; SpaceRed/FunctionalForHikes preview show the day of month '12' (docs default 18)." },
  { id: 52, name: "Week", category: "enum", evidence: "verified", imageCount: 8, note: "Selected_Res with 8 images (index = weekday 1..7, slot 0 unused) beside the date; SpaceRed preview shows the weekday glyph, SimpleItalic (v1) cover shows 'MON'." },
  { id: 0, name: "Steps", category: "raw", evidence: "verified", note: "Combined_Res in the container whose ring shows '7645' (FunctionalForHikes; docs default Steps = 7645)." },
  { id: 2, name: "Heart Rate", category: "raw", evidence: "verified", note: "Combined_Res in the heart icon ring showing '97' (docs default Heart Rate = 97)." },
  { id: 8, name: "Altitude", category: "raw", evidence: "verified", note: "Combined_Res/Arc_Text under the mountain icon; FunctionalForHikes ring '548', AppleUltraRed arc text '1548'." },
  { id: 4, name: "Temperature", category: "raw", evidence: "verified", note: "Combined_Res with a degree sign (res_sign) next to the weather icon: '24 °C'." },
  { id: 9, name: "Power", category: "raw", evidence: "verified", note: "Combined_Res/Text/Arc_Text showing battery '100 %'; GT3 sample description says 'POWER'." },
  { id: 248, name: "28/11 Weather Types", category: "enum", evidence: "verified", imageCount: 11, note: "Selected_Res with 11 icons next to the temperature; preview shows the weather icon. Whether it is the 11-type or 28-type enum is unresolved: 11 images were used." },
  { id: 59, name: "Hour High", category: "enum", evidence: "verified", imageCount: 3, note: "Digit of the tens of the hour: SimpleItalic (v1) cover '10' is built from glyph tables 59 (3 images, 0..2) and 60; v2 FocusWGTru uses the same ids and counts." },
  { id: 60, name: "Hour Low", category: "enum", evidence: "verified", imageCount: 10, note: "Ones of the hour (10 images); see 59." },
  { id: 61, name: "Minute High", category: "enum", evidence: "verified", imageCount: 6, note: "Tens of the minute (6 images, 0..5): SimpleItalic cover '08'." },
  { id: 62, name: "Minute Low", category: "enum", evidence: "verified", imageCount: 10, note: "Ones of the minute (10 images)." },
  { id: 63, name: "Second High", category: "enum", evidence: "inferred", imageCount: 6, note: "Selected_Res with 6 images." },
  { id: 64, name: "Second Low", category: "enum", evidence: "inferred", imageCount: 10, note: "Selected_Res with 10 images." },
  { id: 51, name: "Month", category: "enum", evidence: "verified", imageCount: 13, note: "Glyph/Selected_Res with 12 months (index = month 1..12): SimpleItalic cover shows 'NOV'; GT3 Hublot sample has the 13-image form." },
  { id: 70, name: "Date High", category: "enum", evidence: "verified", imageCount: 4, note: "Tens of the day of month (4 images, 0..3): SimpleItalic cover '16'." },
  { id: 71, name: "Date Low", category: "enum", evidence: "verified", imageCount: 10, note: "Ones of the day of month (10 images)." },
  { id: 150, name: "Hour 12 Ratio", category: "ratio", evidence: "inferred", note: "HAND_RES, shortest of three hands (Hublot GT3); 0..360 degrees. Could be Hour 24 Ratio." },
  { id: 153, name: "Minute Ratio", category: "ratio", evidence: "inferred", note: "HAND_RES, middle hand (Hublot GT3)." },
  { id: 154, name: "Second Ratio", category: "ratio", evidence: "verified", note: "HAND_RES 0..360 degrees: SimpleItalic (v1) cover shows the red dot that sweeps the seconds; v2 NikeCombo uses 154 for a seconds ring." },
  { id: 161, name: "Steps Ratio", category: "ratio", evidence: "verified", note: "FocusWGTru: ARC_RES 161 in container data_type 10 with ARC_TEXT 0 ('7645'); the top ring is filled about 76 %, Huawei's default Steps Ratio." },
  { id: 157, name: "Heart Rate Ratio", category: "ratio", evidence: "verified", note: "FocusWGTru: ARC_RES 157 in container data_type 11 with ARC_TEXT 2 (heart '97'); the ring is filled about 38 % as Huawei's default (97 of 255)." },
  { id: 170, name: "Altitude Ratio", category: "ratio", evidence: "inferred", note: "ARC_RES in the same container as Altitude (8)." },
  { id: 163, name: "Power Ratio", category: "ratio", evidence: "verified", note: "NikeCombo and FocusWGTru battery arcs (container data_type 17, text id 9) are filled to the shown 56 % / lightning level; SpaceRed battery container also pairs it with 9." },
  { id: 54, name: "Power Enum", category: "enum", evidence: "inferred", imageCount: 11, note: "Selected_Res with 11 images (0..100 % in 10 % steps) in the battery container." },
  { id: 167, name: "Temperature Ratio", category: "ratio", evidence: "inferred", note: "HAND_RES -140..140 degrees in the weather container (gauge with a dot, AppleUltraRed/NikeCombo)." },
  { id: 53, name: "?", category: "enum", evidence: "unknown", imageCount: 11, note: "Selected_Res with 11 images, 24x24 icons (AppleUltraRed)." },
  { id: 158, name: "Activity ring (outer)", category: "ratio", evidence: "unknown", note: "ARC_RES of the outer ring in the three-ring set 158 (48px) / 160 (36px) / 159 (24px) (NikeCombo, FocusWGTru, Nike9, SpaceRed2); container data_type 12, text id 1. One of Calorie/Strength Time/Standup ratio; Apple-ring order (outer = calories) suggests Calorie ratio, but no preview number fixes it." },
  { id: 159, name: "Activity ring (inner)", category: "ratio", evidence: "unknown", note: "Inner ring, container data_type 15, text id 15. Most likely Standup Times ratio (innermost ring; text '7' in NikeCombo). Unconfirmed." },
  { id: 160, name: "Activity ring (middle)", category: "ratio", evidence: "unknown", note: "Middle ring, container data_type 13, text id 3. FocusWGTru pairs it with a dumbbell icon and '0'; probably Strength Time ratio. Unconfirmed." },
  { id: 1, name: "Activity text A (calories or strength time)", category: "raw", evidence: "unknown", note: "ARC_TEXT in ring container data_type 12 (FocusWGTru: flame icon, text '26'; NikeCombo: '26'). Ids 0 steps, 2 heart rate are neighbours and Huawei Health's goal order is steps, calories, exercise minutes, stand hours, so Calories is the leading candidate; but Huawei's doc default for Strength Time is exactly 26 (Calorie default 328), which points the other way. NOT resolved: do not export as calories." },
  { id: 3, name: "Activity text B (calories or strength time)", category: "raw", evidence: "unknown", note: "ARC_TEXT in ring container data_type 13 (FocusWGTru: dumbbell icon, text '0'; NikeCombo '0'). See id 1." },
  { id: 15, name: "Activity text C (standup times?)", category: "raw", evidence: "unknown", note: "ARC_TEXT in ring container data_type 15 (innermost ring; NikeCombo '7'). Probably Standup Times." },
  { id: 20, name: "Temperature Max", category: "raw", evidence: "verified", note: "NikeCombo weather gauge: TEXT2_RES '45°' at the high end of the arc, beside the temperature hand (167) and the current '24°' (4)." },
  { id: 21, name: "Temperature Min", category: "raw", evidence: "verified", note: "NikeCombo weather gauge: TEXT2_RES '-18°' at the low end of the arc." },
  { id: 30, name: "Date Yesterday", category: "raw", evidence: "inferred", note: "NikeCombo ARC_TEXT left of the date (17) on the dial: preview reads '3 · 4 · 5' with 4 = today; left slot = 30, right slot = 31." },
  { id: 31, name: "Date Tomorrow", category: "raw", evidence: "inferred", note: "See 30." },
  { id: 172, name: "?", category: "ratio", evidence: "unknown", note: "ARC_RES in container data_type 16 with ARC_TEXT id 26 (FocusWGTru bottom arc, smiley/exclamation icons, text '36'). Likely stress/emotion related; unresolved." },
  { id: 26, name: "?", category: "raw", evidence: "unknown", note: "ARC_TEXT of container data_type 16, see 172." },
  { id: 72, name: "?", category: "enum", evidence: "unknown", imageCount: 1, note: "Selected_Res, 1 image 16x16 (GT3 Hublot)." },
  { id: 73, name: "?", category: "enum", evidence: "unknown", imageCount: 2, note: "Selected_Res, 2 images 40x34 (FocusWGTru)." },
  { id: 231, name: "?", category: "text", evidence: "unknown", note: "TEXT in the DATE element of the GT3 Hublot face (text data, probably week/month text)." },
  { id: 232, name: "?", category: "text", evidence: "unknown", note: "value_type_two of the TEXT2_RES (connection text) beside Date (17) in the Hublot GT3 face." },
];

/** Names → id for the entries with `verified` or `inferred` evidence. */
export const VALUE_TYPE = {
  hour: 12,
  minute: 13,
  date: 17,
  week: 52,
  steps: 0,
  heartRate: 2,
  altitude: 8,
  temperature: 4,
  power: 9,
  weatherType: 248,
  hourHigh: 59,
  hourLow: 60,
  minuteHigh: 61,
  minuteLow: 62,
  secondHigh: 63,
  secondLow: 64,
  month: 51,
  dateHigh: 70,
  dateLow: 71,
  hourRatio: 150,
  minuteRatio: 153,
  secondRatio: 154,
  stepsRatio: 161,
  heartRateRatio: 157,
  altitudeRatio: 170,
  powerRatio: 163,
  powerEnum: 54,
  temperatureRatio: 167,
  temperatureMax: 20,
  temperatureMin: 21,
  dateYesterday: 30,
  dateTomorrow: 31,
} as const;

export function valueTypeInfo(id: number): ValueTypeInfo | undefined {
  return VALUE_TYPES.find((v) => v.id === id);
}

/**
 * Container `data_type` (the widget slot a container belongs to) as read off the Fit 4 Pro samples' previews:
 * 10 steps, 11 heart rate, 17 power (battery), 21 weather/temperature, 22 altitude. Others seen (12, 13, 15, 33) are the
 * activity-ring/arc-text slots and are not identified.
 */
export const WIDGET_DATA_TYPE = { steps: 10, heartRate: 11, power: 17, weather: 21, altitude: 22 } as const;

/** Which draw types the Huawei docs say can show each data category (Data Types page, "Applicable Controls"). */
export const CATEGORY_DRAW_TYPES: Record<DataCategory, readonly string[]> = {
  raw: ["DRAW_TYPE_TEXT", "DRAW_TYPE_ARC_TEXT", "DRAW_TYPE_TEXT2_RES", "DRAW_TYPE_COMBINED_RES"],
  text: ["DRAW_TYPE_TEXT", "DRAW_TYPE_ARC_TEXT", "DRAW_TYPE_TEXT2_RES"],
  enum: ["DRAW_TYPE_SELECTED_RES", "DRAW_TYPE_SELECTED_LAYER"],
  ratio: ["DRAW_TYPE_HAND_RES", "DRAW_TYPE_LINE_RES", "DRAW_TYPE_ARC_RES"],
};
