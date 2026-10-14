package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `DietMeal` in `HuaweiWearDiet.types.ts`. [eatTime] is Unix seconds. */
class DietMealRecord : Record {
  @Field var id: String? = null
  @Field var eatTime: Long = 0
  @Field var kcal: Double = 0.0
  @Field var whichMeal: Int = 40
  @Field var carbs: Double? = null
  @Field var protein: Double? = null
  @Field var fat: Double? = null
}

/** `DietGoals` in `HuaweiWearDiet.types.ts`. */
class DietGoalsRecord : Record {
  @Field var dailyKcal: Int = 0
  @Field var deficitKcal: Int = 0
  @Field var weightInitKg: Double? = null
  @Field var targetWeightKg: Double? = null
  @Field var weightManagerType: Int = 0
  @Field var activityCalGoal: Int? = null
}

/** `DietDay` in `HuaweiWearDiet.types.ts`. */
class DietDayRecord : Record {
  @Field var date: String = ""
  @Field var meals: List<DietMealRecord> = emptyList()
  @Field var goals: DietGoalsRecord? = null
}

/** `BodyMetricsUpdate` in `HuaweiWearDiet.types.ts`: only the fields that are set are stored. Times are Unix ms. */
class BodyMetricsRecord : Record {
  @Field var weightKg: Double? = null
  @Field var weightTs: Long? = null
  @Field var bodyFatPct: Double? = null
  @Field var bodyFatTs: Long? = null
  @Field var restingKcal: Int? = null
  @Field var systolic: Int? = null
  @Field var diastolic: Int? = null
  @Field var bpTs: Long? = null
}

/** `ActivityGoals` in `HuaweiWearDiet.types.ts`. */
class ActivityGoalsRecord : Record {
  @Field var steps: Int = ActivityGoalsData.DEFAULT_STEPS
  @Field var calories: Int = ActivityGoalsData.DEFAULT_CALORIES
  @Field var exerciseMinutes: Int = ActivityGoalsData.DEFAULT_EXERCISE_MINUTES
  @Field var standHours: Int = ActivityGoalsData.DEFAULT_STAND_HOURS
  @Field var remindStand: Boolean = true
  @Field var remindProgress: Boolean = true
  @Field var remindGoalReached: Boolean = true
}

/**
 * The calorie-intake, body-metrics and activity-ring-goal part of the `HuaweiWear` module (`setDietDay` ... `sendActivityGoals`
 * in `HuaweiWearModule.ts`). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.dietApi(runtime: () -> WearRuntime) {
  AsyncFunction("setDietDay") Coroutine { day: DietDayRecord ->
    val meals = day.meals.mapIndexed { index, m ->
      DietMeal(
        id = m.id ?: "app-${day.date}-$index",
        eatTime = m.eatTime,
        kcal = m.kcal,
        whichMeal = m.whichMeal,
        carbs = m.carbs,
        protein = m.protein,
        fat = m.fat,
      )
    }
    val goals = day.goals?.let {
      DietGoals(it.dailyKcal, it.deficitKcal, it.weightInitKg, it.targetWeightKg, it.weightManagerType, it.activityCalGoal)
    }
    runtime().diet.setDay(day.date, meals, goals)
  }

  Function("getDietStatus") {
    runtime().diet.status()
  }

  AsyncFunction("pushDietNow") Coroutine { ->
    runtime().diet.push("manual", withConfig = true)
  }

  AsyncFunction("markWatchMealsSynced") { ids: List<String> ->
    runtime().diet.markWatchMealsSynced(ids)
  }

  Function("getBodyMetrics") {
    runtime().bodyMetrics.load().toJs()
  }

  AsyncFunction("setBodyMetrics") Coroutine { update: BodyMetricsRecord ->
    runtime().bodyMetrics.set(
      BodyMetricsData(
        weightKg = update.weightKg,
        weightTsMs = update.weightTs,
        bodyFatPct = update.bodyFatPct,
        bodyFatTsMs = update.bodyFatTs,
        restingKcal = update.restingKcal,
        systolic = update.systolic,
        diastolic = update.diastolic,
        bpTsMs = update.bpTs,
      ),
    ).toJs()
  }

  Function("getActivityGoals") {
    runtime().activityGoals.status()
  }

  /** Stores the goals and reminders and sends them; true when they all reached the watch. The steps goal also goes into the profile's. */
  AsyncFunction("setActivityGoals") Coroutine { goals: ActivityGoalsRecord ->
    val rt = runtime()
    val data = ActivityGoalsData(
      goals.steps, goals.calories, goals.exerciseMinutes, goals.standHours,
      goals.remindStand, goals.remindProgress, goals.remindGoalReached,
    )
    ActivityGoalsCodec.validate(data)
    // The ring's steps goal and the profile's daily step goal are one number; keep them equal (the profile goes out as MotionGoal 07/01).
    rt.settings.profile?.let { profile -> if (profile.dailyStepGoal != data.steps) rt.setUserProfile(profile.copy(dailyStepGoal = data.steps)) }
    rt.activityGoals.set(data)
  }

  AsyncFunction("sendActivityGoals") Coroutine { ->
    runtime().activityGoals.send("manual")
  }
}
