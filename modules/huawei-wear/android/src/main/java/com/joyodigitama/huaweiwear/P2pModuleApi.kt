package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `RunningCourseStep` in `HuaweiWear.types.ts`. */
class RunningCourseStepRecord : Record {
  @Field var kind: String = "run"
  @Field var target: String = "time"
  @Field var targetValue: Int = 0
  @Field var intensity: String = "none"
  @Field var low: Int = 0
  @Field var high: Int = 0
}

/** `RunningCourseBlock` in `HuaweiWear.types.ts`. */
class RunningCourseBlockRecord : Record {
  @Field var repeat: Int = 1
  @Field var steps: List<RunningCourseStepRecord> = emptyList()
}

/** `RunningCourse` in `HuaweiWear.types.ts`. */
class RunningCourseRecord : Record {
  @Field var name: String = ""
  @Field var blocks: List<RunningCourseBlockRecord> = emptyList()

  internal fun toCourse(): RunningCourse {
    fun bad(what: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, what)
    val converted = blocks.map { block ->
      CourseBlock(
        block.repeat,
        block.steps.map { s ->
          CourseStep(
            kind = CourseStepKind.of(s.kind) ?: bad("Unknown step kind '${s.kind}'"),
            target = CourseTarget.of(s.target) ?: bad("Unknown target '${s.target}'"),
            targetValue = s.targetValue,
            intensity = CourseIntensity.of(s.intensity) ?: bad("Unknown intensity '${s.intensity}'"),
            low = s.low,
            high = s.high,
          )
        },
      )
    }
    // Huawei's exerciseId of a custom course is a generated id; any stable unique string works for the watch's list.
    return RunningCourse("JF" + java.lang.Long.toString(System.currentTimeMillis(), 36).uppercase(), name.trim(), converted)
  }
}

/**
 * The P2P (service 0x34) part of the `HuaweiWear` module: Healthy Living (`getHealthyLiving` ... `pushHealthyLiving`) and
 * the experimental running courses (`getCourses`, `setCoursesEnabled`, `pushRunningCourse`). The health metrics need no
 * function: the sync stores them in `health_metrics` / `health_metric_status`, which JS reads. Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.p2pApi(runtime: () -> WearRuntime) {
  Function("getHealthyLiving") {
    runtime().p2p.healthLivingStatus()
  }

  AsyncFunction("setHealthyLivingEnabled") { enabled: Boolean ->
    runtime().p2p.setHealthLivingEnabled(enabled)
  }

  AsyncFunction("pushHealthyLiving") Coroutine { ->
    runtime().p2p.pushHealthLiving()
  }

  Function("getCourses") {
    runtime().p2p.coursesStatus()
  }

  AsyncFunction("setCoursesEnabled") { enabled: Boolean ->
    runtime().p2p.settings.experimentalCourses = enabled
  }

  AsyncFunction("pushRunningCourse") Coroutine { course: RunningCourseRecord ->
    runtime().p2p.pushCourse(course.toCourse())
  }
}
