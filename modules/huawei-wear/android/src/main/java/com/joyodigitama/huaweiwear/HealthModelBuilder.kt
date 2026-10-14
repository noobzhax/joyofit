package com.joyodigitama.huaweiwear

import com.joyodigitama.huaweiwear.HealthModelMessages.Clover
import com.joyodigitama.huaweiwear.HealthModelMessages.Task
import com.joyodigitama.huaweiwear.HealthModelMessages.TaskBody
import kotlin.math.max
import kotlin.math.min

/** What JoyoFit knows about one local day, as the Healthy Living tasks need it. Null = no data / not tracked. */
internal class HealthDay(
  /** `yyyyMMdd`, Huawei's `recordDay` (`DateFormatUtil.a`: year * 10000 + month * 100 + day). */
  val recordDay: Int,
  val steps: Int,
  val stepGoal: Int,
  /** Minutes of workout sessions that day. */
  val exerciseMinutes: Int,
  /** Seconds of sleep that ended that day (night + naps), null when no sleep was stored. */
  val sleepSeconds: Int?,
  val intakeKcal: Double?,
  val weightKg: Double?,
  val bloodPressure: Boolean,
  /** A stress / emotion reading from the watch exists that day. */
  val stressMeasured: Boolean,
  /** Unix ms of the newest data point behind the tasks (steps, sleep ...), the `timestamp` field of the tasks. */
  val timestampMs: Long,
)

/** The goals Huawei Health's Healthy Living plan would hold; JoyoFit has no goal editor for them, so they are fixed or taken from the profile. */
internal class HealthGoals(
  val exerciseMinutes: Int = DEFAULT_EXERCISE_MINUTES,
  val sleepSeconds: Int = DEFAULT_SLEEP_SECONDS,
  val intakeKcal: Int = DEFAULT_INTAKE_KCAL,
) {
  companion object {
    const val DEFAULT_EXERCISE_MINUTES = 30
    const val DEFAULT_SLEEP_SECONDS = 8 * 3600
    const val DEFAULT_INTAKE_KCAL = 2000
  }
}

/**
 * Builds the TaskBody the watch's Healthy Living app asks for (`bxc.getTaskData` / `ccj.b` in Huawei
 * Health 17.0.8.300). Task ids are `WearTaskEnum`'s wear ids; the cloud ids in brackets are what Huawei
 * calls them:
 *
 * | id | task | value / target |
 * |---|---|---|
 * | 1 | perfect clover (`status` = every other task done, `taskTarget` = their ids written one after the other) | |
 * | 2 | steps (`T100110`) | steps / goal; `progress` = `max(value / target, 0.1)` as `bxc.a(String, String)` |
 * | 3 | exercise minutes (`T100210`) | minutes / goal |
 * | 18 | sleep duration (`T121410`) | seconds / goal seconds |
 * | 17 | calorie intake (`T121310`) | kcal / goal |
 * | 14 | weight measurement (`T121110`) | times done / 1 |
 * | 12 | blood pressure measurement (`T121010`) | times done / 1 |
 *
 * Water (10) is left out: JoyoFit does not record water. `taskType` is the leaf (1 sport) only for the basic
 * tasks of a watch without ExpandCapability 303, as `WearTaskEnum.getTaskTypeByTaskId` returns for it.
 *
 * Everything about the values is Huawei's layout read from code; what the watch draws from it is UNVERIFIED.
 */
internal object HealthModelBuilder {
  const val TASK_PERFECT_CLOVER = 1
  const val TASK_STEPS = 2
  const val TASK_EXERCISE = 3
  const val TASK_WATER = 10
  const val TASK_BLOOD_PRESSURE = 12
  const val TASK_WEIGHT = 14
  const val TASK_INTAKE = 17
  const val TASK_SLEEP = 18

  fun build(day: HealthDay, goals: HealthGoals, requestedIds: Set<Int>?): TaskBody {
    val all = ArrayList<Task>()
    val ts = day.timestampMs

    val stepGoal = max(day.stepGoal, 1)
    val stepRatio = day.steps.toFloat() / stepGoal
    all.add(
      Task(
        taskId = TASK_STEPS,
        taskTarget = stepGoal.toString(),
        taskValue = day.steps.toString(),
        status = if (day.steps >= stepGoal) 1 else 0,
        taskType = 1,
        timestamp = ts,
        taskName = "Steps",
        progress = if (stepRatio <= 0f) 0f else max(stepRatio, 0.1f),
        statusDes = "${day.steps}/$stepGoal",
      ),
    )
    all.add(
      Task(
        taskId = TASK_EXERCISE,
        taskTarget = goals.exerciseMinutes.toString(),
        taskValue = day.exerciseMinutes.toString(),
        status = if (day.exerciseMinutes >= goals.exerciseMinutes) 1 else 0,
        taskType = 0,
        timestamp = ts,
        taskName = "Exercise",
        statusDes = "${day.exerciseMinutes}/${goals.exerciseMinutes} min",
      ),
    )
    day.sleepSeconds?.let { sleep ->
      all.add(
        Task(
          taskId = TASK_SLEEP,
          taskTarget = goals.sleepSeconds.toString(),
          taskValue = sleep.toString(),
          status = if (sleep >= goals.sleepSeconds) 1 else 0,
          timestamp = ts,
          taskName = "Sleep",
          statusDes = "%.1f/%.1f h".format(sleep / 3600.0, goals.sleepSeconds / 3600.0),
        ),
      )
    }
    day.intakeKcal?.let { kcal ->
      val eaten = kcal.toInt()
      all.add(
        Task(
          taskId = TASK_INTAKE,
          taskTarget = goals.intakeKcal.toString(),
          taskValue = eaten.toString(),
          status = if (eaten > 0) 1 else 0,
          timestamp = ts,
          taskName = "Calorie intake",
          statusDes = "$eaten/${goals.intakeKcal} kcal",
        ),
      )
    }
    if (day.weightKg != null) {
      all.add(Task(taskId = TASK_WEIGHT, taskTarget = "1", taskValue = "1", status = 1, timestamp = ts, taskName = "Weight", statusDes = "1/1"))
    }
    if (day.bloodPressure) {
      all.add(Task(taskId = TASK_BLOOD_PRESSURE, taskTarget = "1", taskValue = "1", status = 1, timestamp = ts, taskName = "Blood pressure", statusDes = "1/1"))
    }

    val perfect = Task(
      taskId = TASK_PERFECT_CLOVER,
      taskTarget = all.joinToString("") { it.taskId.toString() },
      status = if (all.all { it.status > 0 }) 1 else 0,
      taskName = "Perfect clover",
    )
    val withClover = listOf(perfect) + all
    val shown = if (requestedIds == null || requestedIds.isEmpty()) withClover else withClover.filter { it.taskId in requestedIds }

    return TaskBody(
      resultCode = 0,
      resultDes = "",
      recordDay = day.recordDay,
      // bxc.a: allTasks is "1," + the wear id of every task of the day; completedTasks lists the finished ones.
      allTasks = withClover.joinToString(",") { it.taskId.toString() },
      tasks = shown,
      completedTasks = all.filter { it.status > 0 }.joinToString(",") { it.taskId.toString() },
      clover = clover(day, goals, stepRatio),
    )
  }

  /**
   * The three leaves of a watch without ExpandCapability 303 (`bxc.b(map, cloverProgress, list)`):
   * top = sport = steps value / target (capped at 1); left = sleep; right = mind.
   *
   * Huawei fills left from "wake up at the planned time" and right from the relaxation / average-pressure
   * tasks. JoyoFit has neither plan, so (UNVERIFIED substitution) left = sleep seconds / sleep goal (capped
   * at 1) and right = 1 when a stress reading exists that day, else 0.
   */
  fun clover(day: HealthDay, goals: HealthGoals, stepRatio: Float = day.steps.toFloat() / max(day.stepGoal, 1)): Clover {
    val top = min(1f, max(stepRatio, 0f))
    val left = day.sleepSeconds?.let { min(1f, it.toFloat() / goals.sleepSeconds) } ?: 0f
    val right = if (day.stressMeasured) 1f else 0f
    return Clover(top = top, left = left, right = right, bottom = 0f)
  }

  /**
   * Splits [body] into reports no bigger than the watch's `packageSize` (`ccj.d`): every page repeats the header
   * fields and clover, tasks fill the page until the next one would not fit. Huawei measures the size in hex
   * characters of the serialized bytes, so half of `packageSize` is used as the byte budget. `packageSize` <= 0
   * (old watches, or `msgVer` below 3) sends one report.
   */
  fun reports(body: TaskBody, msgVer: Float, packageSize: Int): List<ByteArray> {
    val budget = if (packageSize <= 0) Int.MAX_VALUE else max(packageSize / 2, MIN_PAGE_BYTES)
    val pages = ArrayList<ByteArray>()
    val remaining = ArrayList(body.tasks)
    do {
      val page = ArrayList<Task>()
      val header = TaskBody(body.resultCode, body.resultDes, body.recordDay, body.allTasks, emptyList(), body.completedTasks, body.clover)
      var used = HealthModelMessages.encodeReport(HealthModelMessages.MSG_TASKS, msgVer, HealthModelMessages.encodeTaskBody(header)).size
      while (remaining.isNotEmpty()) {
        val size = HealthModelMessages.encodeTask(remaining[0]).size + TASK_FIELD_OVERHEAD
        if (page.isNotEmpty() && used + size >= budget) break
        page.add(remaining.removeAt(0))
        used += size
      }
      val pageBody = TaskBody(body.resultCode, body.resultDes, body.recordDay, body.allTasks, page, body.completedTasks, body.clover)
      pages.add(HealthModelMessages.encodeReport(HealthModelMessages.MSG_TASKS, msgVer, HealthModelMessages.encodeTaskBody(pageBody)))
    } while (remaining.isNotEmpty())
    return pages
  }

  private const val MIN_PAGE_BYTES = 64

  /** Tag + length bytes of a `tasks` entry inside TaskBody and the extra length byte of the Report's `msgBody`. */
  private const val TASK_FIELD_OVERHEAD = 4
}
