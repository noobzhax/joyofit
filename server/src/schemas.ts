import { z } from "zod";

import {
  MAX_DEVICES,
  MAX_POINTS_PER_WORKOUT,
  MAX_SLEEP_SEGMENTS,
  MAX_STEP_SAMPLES,
  MAX_WORKOUTS,
} from "./limits";

/** Latest unix second the schema accepts: 2100-01-01. */
const MAX_UNIX_SECONDS = 4_102_444_800;
const MAX_COUNTER = 2_147_483_647;

const unixSeconds = z.number().int().min(0).max(MAX_UNIX_SECONDS);
const counter = z.number().int().min(0).max(MAX_COUNTER);
const nullableInt = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? null);
const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => v ?? null);

export const stepSampleSchema = z.object({
  timestamp: unixSeconds,
  steps: counter,
  calories: counter,
  distance: counter,
  heartRate: nullableInt(0, 300),
  spo2: nullableInt(0, 100),
  restingHeartRate: nullableInt(0, 300),
});

export const sleepSegmentSchema = z.object({
  start: unixSeconds,
  end: unixSeconds,
  type: z.number().int().min(0).max(1_000),
  stage: nullableText(32),
});

export const workoutPointSchema = z.object({
  ts: unixSeconds,
  lat: z
    .number()
    .min(-90)
    .max(90)
    .nullish()
    .transform((v) => v ?? null),
  lon: z
    .number()
    .min(-180)
    .max(180)
    .nullish()
    .transform((v) => v ?? null),
  alt: z
    .number()
    .min(-20_000)
    .max(100_000)
    .nullish()
    .transform((v) => v ?? null),
  hr: nullableInt(0, 300),
});

export const workoutSchema = z.object({
  workoutNumber: counter,
  start: unixSeconds,
  end: unixSeconds,
  sportType: z.number().int().min(0).max(65_535),
  sportName: z.string().max(64),
  duration: counter,
  distance: counter,
  calories: counter,
  avgHr: nullableInt(0, 300),
  maxHr: nullableInt(0, 300),
  steps: counter,
  summaryJson: z.string().max(200_000),
  complete: z.boolean(),
  points: z.array(workoutPointSchema).max(MAX_POINTS_PER_WORKOUT).default([]),
});

export const deviceSchema = z.object({
  address: z.string().min(1).max(64),
  name: z.string().max(128),
  productModel: nullableText(128),
  softwareVersion: nullableText(128),
  lastSync: unixSeconds.nullish().transform((v) => v ?? null),
});

export const syncBodySchema = z.object({
  stepSamples: z.array(stepSampleSchema).max(MAX_STEP_SAMPLES).default([]),
  sleepSegments: z.array(sleepSegmentSchema).max(MAX_SLEEP_SEGMENTS).default([]),
  workouts: z.array(workoutSchema).max(MAX_WORKOUTS).default([]),
  devices: z.array(deviceSchema).max(MAX_DEVICES).default([]),
});

export type SyncBody = z.output<typeof syncBodySchema>;
export type StepSampleInput = z.output<typeof stepSampleSchema>;
export type SleepSegmentInput = z.output<typeof sleepSegmentSchema>;
export type WorkoutInput = z.output<typeof workoutSchema>;
export type DeviceInput = z.output<typeof deviceSchema>;
