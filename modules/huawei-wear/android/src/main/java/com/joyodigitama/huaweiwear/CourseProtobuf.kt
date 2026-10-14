package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.utils.HuaweiP2PSubMsg

/**
 * The running course that Huawei Health pushes to `in.huawei.fitness` (P2P module `fitness`):
 * `iiz.e(FitWorkout, ...)` writes `<messageId>courseInfo.bin` = a 36-byte little-endian message header
 * ([HuaweiP2PSubMsg]; `dft` in Huawei Health: businessType, version, totalLength, businessHeadLength, messageId) +
 * a `CourseStorageInfo` protobuf, and sends it as a P2P file. EXPERIMENTAL and UNVERIFIED on the wire: everything here is
 * read from Huawei Health 17.0.8.300 (`iiz`, `BaseCoursePlanDataCustomer`, `CourseDataForDevice`, `CustomCourseActivity`,
 * `EditDialogBuilder`, `TypeConfig`); see `protocol/README.md` for what is missing.
 *
 * `course.proto` (proto2, every field `required`, extracted from the generated descriptor):
 * ```
 * message CourseStorageInfo {
 *   required string exerciseId = 1;           repeated uint32 exerciseName = 2;   // the name's UTF-8 bytes, one varint each (dga.e)
 *   required uint32 totalMeasurementType = 3; required uint32 totalMeasurementValue = 4;
 *   required string exerciseVersion = 5;      required uint32 difficult = 6;      required uint32 usingType = 7;
 *   required uint32 updateTime = 8;           required uint32 defineType = 9;     required uint32 courseType = 10;
 *   required uint32 actionTotalNum = 11;      repeated CombineInfo combineInfo = 12;
 *   message ActionInfo  { required string actionId = 1; required uint32 measurementType = 2; required uint32 measurementValue = 3;
 *                         required uint32 instensityType = 4; required uint32 instensityValueH = 5; required uint32 instensityValueL = 6; }
 *   message CombineInfo { required uint32 repeatNum = 1; required uint32 actionNum = 2; repeated ActionInfo actionInfo = 3; }
 * }
 * ```
 * (`instensity` is Huawei's spelling.) Values Huawei Health's custom-course editor writes (`CustomCourseActivity`): `courseType` 4
 * (a "new run course"), `defineType` 1 (custom), `exerciseVersion` "2.0", `usingType` 0 for a single course; target types
 * (`TypeConfig.getTargetTypeList`) 1 time (seconds), 0 distance (metres), 3 calories, 5 heart rate, 255 none; intensity types
 * (`getIntensityTypeList`) 255 none, 13 pace zone, 15 pace, 16 cadence, 17 heart-rate zone, 1 heart-rate range; action ids
 * RD001 warm-up, RD002 run, RD003 walk, RD004 rest, RD005 relax (cool-down).
 */
internal enum class CourseStepKind(val wire: String, val actionId: String) {
  WARMUP("warmup", "RD001"),
  RUN("run", "RD002"),
  WALK("walk", "RD003"),
  REST("rest", "RD004"),
  COOLDOWN("cooldown", "RD005"),
  ;

  companion object {
    fun of(wire: String): CourseStepKind? = entries.firstOrNull { it.wire == wire }
  }
}

/** `TypeConfig` target ids. */
internal enum class CourseTarget(val wire: String, val id: Int) {
  TIME("time", 1),
  DISTANCE("distance", 0),
  NONE("none", 255),
  ;

  companion object {
    fun of(wire: String): CourseTarget? = entries.firstOrNull { it.wire == wire }
  }
}

/** `TypeConfig` intensity ids the editor offers; the values are what `EditDialogBuilder` stores in valueL / valueH. */
internal enum class CourseIntensity(val wire: String, val id: Int) {
  NONE("none", 255),

  /** Seconds per kilometre, sent as milliseconds per kilometre (`EditDialogBuilder`: `i7 * 1000`); low = the faster bound. */
  PACE("pace", 15),

  /** Percent of maximum heart rate, 20 to 100 (`IntensityHeartRateRange`). */
  HEART_RATE_PERCENT("hrPercent", 1),

  /** Steps per minute, 100 to 300 (`IntensityStepRate`). */
  CADENCE("cadence", 16),
  ;

  companion object {
    fun of(wire: String): CourseIntensity? = entries.firstOrNull { it.wire == wire }
  }
}

internal class CourseStep(
  val kind: CourseStepKind,
  val target: CourseTarget,
  /** Seconds for [CourseTarget.TIME], metres for [CourseTarget.DISTANCE], 0 for none. */
  val targetValue: Int,
  val intensity: CourseIntensity = CourseIntensity.NONE,
  /** Lower and upper bound in the unit of [intensity] (pace: seconds per km; the faster one is [low]). */
  val low: Int = 0,
  val high: Int = 0,
)

/** [steps] repeated [repeat] times, as `ChoreographedMultiActions`; a single step with repeat 1 is a plain action. */
internal class CourseBlock(val repeat: Int, val steps: List<CourseStep>)

internal class RunningCourse(val id: String, val name: String, val blocks: List<CourseBlock>) {
  val actionCount: Int get() = blocks.sumOf { it.steps.size }
}

internal object CourseProtobuf {
  const val BUSINESS_CUSTOM_COURSE = 3
  const val COURSE_TYPE_NEW_RUN = 4
  const val DEFINE_TYPE_CUSTOM = 1
  const val USING_TYPE_SINGLE = 0
  const val EXERCISE_VERSION = "2.0"
  const val MAX_ACTIONS = 100

  private const val MAX_NAME_BYTES = 64

  /** Validates what the editor sends; the exception message is shown to the user. */
  fun validate(course: RunningCourse) {
    fun bad(what: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, what)
    if (course.name.isBlank()) bad("Give the course a name")
    if (course.name.toByteArray(Charsets.UTF_8).size > MAX_NAME_BYTES) bad("The course name is too long")
    if (course.blocks.isEmpty()) bad("The course needs at least one step")
    if (course.actionCount > MAX_ACTIONS) bad("A course can have at most $MAX_ACTIONS steps")
    for (block in course.blocks) {
      if (block.steps.isEmpty()) bad("A repeated group has no steps")
      if (block.repeat !in 1..99) bad("A group repeats 1 to 99 times")
      for (step in block.steps) {
        when (step.target) {
          CourseTarget.TIME -> if (step.targetValue !in 1..86_400) bad("A time target is 1 s to 24 h")
          CourseTarget.DISTANCE -> if (step.targetValue !in 1..100_000) bad("A distance target is 1 m to 100 km")
          CourseTarget.NONE -> Unit
        }
        when (step.intensity) {
          CourseIntensity.NONE -> Unit
          CourseIntensity.PACE -> {
            if (step.low !in 60..900 || step.high !in 60..900) bad("A pace bound is 1:00 to 15:00 per km")
            if (step.low > step.high) bad("The faster pace must come first")
          }
          CourseIntensity.HEART_RATE_PERCENT -> {
            if (step.low !in 20..100 || step.high !in 20..100) bad("A heart-rate bound is 20 to 100 % of the maximum")
            if (step.low > step.high) bad("The lower heart rate must come first")
          }
          CourseIntensity.CADENCE -> {
            if (step.low !in 100..300 || step.high !in 100..300) bad("A cadence bound is 100 to 300 steps per minute")
            if (step.low > step.high) bad("The lower cadence must come first")
          }
        }
      }
    }
  }

  /**
   * The course's total: seconds when every step has a time target, metres when every step has a distance target, else none.
   * (UNVERIFIED: `FitWorkout.acquireMeasurementType` / `acquireDuration` are filled by code that was not read.)
   */
  fun total(course: RunningCourse): Pair<CourseTarget, Int> {
    val steps = course.blocks.flatMap { b -> List(b.repeat) { b.steps } }.flatten()
    return when {
      steps.all { it.target == CourseTarget.TIME } -> CourseTarget.TIME to steps.sumOf { it.targetValue }
      steps.all { it.target == CourseTarget.DISTANCE } -> CourseTarget.DISTANCE to steps.sumOf { it.targetValue }
      else -> CourseTarget.NONE to 0
    }
  }

  fun encodeAction(step: CourseStep): ByteArray {
    val low: Int
    val high: Int
    when (step.intensity) {
      CourseIntensity.NONE -> {
        low = 0
        high = 0
      }
      CourseIntensity.PACE -> {
        low = step.low * 1000
        high = step.high * 1000
      }
      else -> {
        low = step.low
        high = step.high
      }
    }
    return PbWriter()
      .stringField(1, step.kind.actionId)
      .intField(2, step.target.id)
      .intField(3, if (step.target == CourseTarget.NONE) 0 else step.targetValue)
      .intField(4, step.intensity.id)
      .intField(5, high)
      .intField(6, low)
      .toByteArray()
  }

  fun encodeCombine(block: CourseBlock): ByteArray {
    val w = PbWriter().intField(1, block.repeat).intField(2, block.steps.size)
    for (step in block.steps) w.bytesField(3, encodeAction(step))
    return w.toByteArray()
  }

  /** `CourseStorageInfo` (`BaseCoursePlanDataCustomer.convertFitWorkout`). [updateTimeSec] is the course's publish / modify time. */
  fun encode(course: RunningCourse, updateTimeSec: Int): ByteArray {
    val (totalType, totalValue) = total(course)
    val w = PbWriter()
      .stringField(1, course.id)
    for (b in course.name.toByteArray(Charsets.UTF_8)) w.intField(2, b.toInt() and 0xFF)
    w.intField(3, totalType.id)
      .intField(4, totalValue)
      .stringField(5, EXERCISE_VERSION)
      .intField(6, 0)
      .intField(7, USING_TYPE_SINGLE)
      .intField(8, updateTimeSec)
      .intField(9, DEFINE_TYPE_CUSTOM)
      .intField(10, COURSE_TYPE_NEW_RUN)
      .intField(11, course.actionCount)
    for (block in course.blocks) w.bytesField(12, encodeCombine(block))
    return w.toByteArray()
  }

  /** The 36-byte header (businessType, version 1, totalLength, businessHeadLength 0, messageId; little endian) followed by [payload]. */
  fun message(businessType: Int, messageId: Int, payload: ByteArray): ByteArray = HuaweiP2PSubMsg(businessType, messageId, payload).bytes

  fun fileName(messageId: Int) = "${messageId}courseInfo.bin"
}
