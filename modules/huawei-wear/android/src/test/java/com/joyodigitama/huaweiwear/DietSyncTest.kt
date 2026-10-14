package com.joyodigitama.huaweiwear

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Meal list, ranges and config JSON against Huawei Health's rules (DietRecordHelper / HwSyncWeightManager). */
class DietSyncTest {
  private val today = "2026-10-14"
  private val midnight = 1_760_400_000L
  private val breakfastTime = 1_760_420_000L
  private val goals = DietGoals(dailyKcal = 2000, deficitKcal = 500, weightInitKg = 70.0, weightManagerType = 0)

  private fun day(vararg meals: DietMeal, goals: DietGoals? = this.goals, date: String = today) = DietDay(date, meals.toList(), goals)

  private fun meal(which: Int, kcal: Double, time: Long = breakfastTime, id: String = "m$which$kcal$time") = DietMeal(id, time, kcal, which)

  private fun json(entries: List<DietEntry>) = String(DietPlanner.mealsJson(entries), Charsets.UTF_8)

  @Test
  fun placeholdersFillTheSlotsWithNoMealAndFollowTheExampleShape() {
    val entries = DietPlanner.entries(day(meal(10, 350.0)), extraSlots = false, todayDate = today, todayStartSec = midnight)
    // Recommended ranges for a 2000 kcal day (region it, maintain): breakfast 0.20..0.26, lunch 0.40..0.47, dinner 0.30..0.35, snack 0..0.05.
    assertEquals(
      "[{\"eatTime\":$breakfastTime,\"hasFood\":true,\"kiloCalorie\":350.0,\"sugRange\":[400,520],\"whichMeal\":10}," +
        "{\"eatTime\":$midnight,\"hasFood\":false,\"kiloCalorie\":0.0,\"sugRange\":[800,940],\"whichMeal\":20}," +
        "{\"eatTime\":$midnight,\"hasFood\":false,\"kiloCalorie\":0.0,\"sugRange\":[600,700],\"whichMeal\":30}," +
        "{\"eatTime\":$midnight,\"hasFood\":false,\"kiloCalorie\":0.0,\"sugRange\":[0,100],\"whichMeal\":40}]",
      json(entries),
    )
  }

  @Test
  fun anEmptyTodayGetsFourPlaceholdersWithoutBit215AndThreeWith() {
    val folded = DietPlanner.entries(day(), extraSlots = false, todayDate = today, todayStartSec = midnight)
    assertEquals(listOf(10, 20, 30, 40), folded.map { it.whichMeal })
    assertTrue(folded.none { it.hasFood })
    val extra = DietPlanner.entries(day(), extraSlots = true, todayDate = today, todayStartSec = midnight)
    assertEquals(listOf(10, 20, 30), extra.map { it.whichMeal })
  }

  @Test
  fun placeholdersAreOnlyForToday() {
    val entries = DietPlanner.entries(day(meal(20, 600.0), date = "2026-10-13"), extraSlots = false, todayDate = today, todayStartSec = midnight)
    assertEquals(listOf(20), entries.map { it.whichMeal })
  }

  @Test
  fun mealsOfOneTypeAreMergedAndSummed() {
    val entries = DietPlanner.entries(day(meal(10, 200.0, 100), meal(10, 150.5, 200)), extraSlots = false, todayDate = today, todayStartSec = midnight)
    val breakfast = entries.first()
    assertEquals(10, breakfast.whichMeal)
    assertEquals(350.5f, breakfast.kcal, 0f)
    assertEquals(100L, breakfast.eatTime)
    assertTrue(breakfast.hasFood)
  }

  @Test
  fun extraSlotsAreKeptWithBit215AndChangeTheGroupsRange() {
    val entries = DietPlanner.entries(day(meal(10, 300.0, 100), meal(11, 80.0, 200)), extraSlots = true, todayDate = today, todayStartSec = midnight)
    assertEquals(listOf(10, 11, 20, 30), entries.map { it.whichMeal })
    // A day with an extra breakfast: breakfast 0.15..0.21 instead of 0.20..0.26; the extra slot itself 0..0.05.
    assertArrayEquals(intArrayOf(300, 420), entries[0].sugRange)
    assertArrayEquals(intArrayOf(0, 100), entries[1].sugRange)
    // No extra lunch, so lunch keeps the plain range.
    assertArrayEquals(intArrayOf(800, 940), entries[2].sugRange)
  }

  @Test
  fun extraSlotsFoldIntoFortyWithoutBit215() {
    val entries = DietPlanner.entries(day(meal(10, 300.0, 100), meal(11, 80.0, 200), meal(21, 20.0, 300), meal(40, 50.0, 400)), extraSlots = false, todayDate = today, todayStartSec = midnight)
    assertEquals(listOf(10, 40, 20, 30), entries.map { it.whichMeal })
    val snack = entries[1]
    assertEquals(150f, snack.kcal, 0f)
    assertTrue(snack.hasFood)
    // [0, sum of the folded meals' range maxima]: extra breakfast 100, extra lunch 100, snack 100.
    assertArrayEquals(intArrayOf(0, 300), snack.sugRange)
    // Lunch got no placeholder range change: the day has an extra lunch (21), so lunch uses the 0.35..0.42 group.
    assertArrayEquals(intArrayOf(700, 840), entries[2].sugRange)
  }

  @Test
  fun noGoalMeansNoRangeAndAnEmptyArrayForPlaceholders() {
    val entries = DietPlanner.entries(day(meal(10, 100.0), goals = null), extraSlots = true, todayDate = today, todayStartSec = midnight)
    assertNull(entries[0].sugRange)
    assertTrue(entries[1].sugRange!!.isEmpty())
    assertTrue(json(entries).contains("\"sugRange\":[]"))
  }

  @Test
  fun lowerOrGainPlansUseTheirOwnRatios() {
    assertArrayEquals(intArrayOf(500, 640), DietPlanner.range(2000, 10, 1, emptySet()))
    assertArrayEquals(intArrayOf(500, 600), DietPlanner.range(2000, 10, 2, emptySet()))
    assertEquals(0, DietPlanner.range(0, 10, 0, emptySet()).size)
  }

  @Test
  fun typeFoldingMatchesFbjE() {
    assertEquals(40, DietPlanner.fold(11, false))
    assertEquals(40, DietPlanner.fold(21, false))
    assertEquals(40, DietPlanner.fold(31, false))
    assertEquals(11, DietPlanner.fold(11, true))
    assertEquals(20, DietPlanner.fold(20, false))
    assertTrue(DietPlanner.isMealType(31))
    assertFalse(DietPlanner.isMealType(50))
  }

  @Test
  fun configJsonFollowsTheIzdFieldOrderAndOnePointFullFormula() {
    // onePointFull = round((min + max) / 14): breakfast (400 + 520) / 14 = 66, lunch (800 + 940) / 14 = 124, dinner (600 + 700) / 14 = 93.
    assertEquals(
      "{\"onePointFull\":{\"dinner\":93,\"lunch\":124,\"breakfast\":66},\"caloricDeficitGoal\":500,\"weightInit\":70.0,\"activityCalGoal\":300," +
        "\"fatLossRatio\":{\"maxRatio\":0.0,\"minRatio\":0.0,\"maxWeek\":0,\"gear\":1},\"weightManagerType\":0}",
      String(DietPlanner.configJson(goals, 300, 70.0), Charsets.UTF_8),
    )
    assertEquals("{\"weightGoal\":62.5}", String(DietPlanner.weightGoalJson(62.5), Charsets.UTF_8))
  }

  @Test
  fun quickLogReplies() {
    assertEquals("{\"punchResult\":0,\"event\":6}", String(DietPlanner.punchReply(0, 0), Charsets.UTF_8))
    assertEquals("{\"punchResult\":102,\"punchFailTime\":1760420000,\"event\":6}", String(DietPlanner.punchReply(102, 1_760_420_000L), Charsets.UTF_8))
  }

  @Test
  fun quickLogParsingKeepsRealMealsAndNormalisesTime() {
    val body = JSONObject(
      "{\"meals\":[{\"whichMeal\":10,\"eatTime\":1760420000,\"kiloCalorie\":350.5,\"timeZone\":\"+07:00\"}," +
        "{\"whichMeal\":0,\"eatTime\":1,\"kiloCalorie\":1}," +
        "{\"whichMeal\":20,\"eatTime\":1760430000000,\"kiloCalorie\":600}],\"startTime\":1760420000}",
    )
    val meals = DietPlanner.parseQuickLog(body, 5L)
    assertEquals(2, meals.size)
    assertEquals(10, meals[0].whichMeal)
    assertEquals(350.5, meals[0].kcal, 0.0)
    assertEquals(1_760_430_000L, meals[1].eatTime)
    assertEquals("watch", meals[0].src)
    assertFalse(meals[0].synced)
    // The array may also arrive as a string (Huawei's getString("meals")).
    val asString = JSONObject().put("meals", "[{\"whichMeal\":30,\"eatTime\":0,\"kiloCalorie\":10}]")
    val parsed = DietPlanner.parseQuickLog(asString, 77L)
    assertEquals(77L, parsed[0].eatTime)
    assertTrue(DietPlanner.parseQuickLog(JSONObject("{}"), 1L).isEmpty())
  }

  @Test
  fun dietaryAnalysisOnlyWhenMacrosAreKnown() {
    assertNull(DietPlanner.analysisJson(day(meal(10, 100.0))))
    val withMacros = day(
      DietMeal("a", 1, 100.0, 10, carbs = 20.5, protein = 5.0, fat = 1.0),
      DietMeal("b", 2, 100.0, 20, carbs = 10.0),
    )
    assertEquals(
      "{\"dietaryAnalysis\":{\"coefficient\":1,\"carbohydrates\":30.5,\"protein\":5.0,\"fat\":1.0}}",
      String(DietPlanner.analysisJson(withMacros)!!, Charsets.UTF_8),
    )
  }

  @Test
  fun theWholeSamplePointCarriesTheMealsAndTheAnalysis() {
    val plain = nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false); it.setSliceSize(1022) }
    val entries = DietPlanner.entries(day(meal(10, 350.0)), false, today, midnight)
    val packet = DataSyncWire.samplePoint(
      plain, DietPlanner.PHONE_PKG, DietPlanner.WATCH_PKG, DietPlanner.DICT_DIET,
      listOf(PointValue(DietPlanner.DICT_DIET, DietPlanner.mealsJson(entries))), 0, 0, DietPlanner.analysisJson(day(DietMeal("a", 1, 1.0, 10, protein = 2.0))),
    )
    val point = DataSyncWire.parsePoint(packet.getTlv())
    assertEquals(DietPlanner.DICT_DIET, point.dictId)
    assertEquals(json(entries), String(point.values.single().value!!, Charsets.UTF_8))
    assertEquals("{\"dietaryAnalysis\":{\"coefficient\":1,\"carbohydrates\":0.0,\"protein\":2.0,\"fat\":0.0}}", String(point.metadata!!, Charsets.UTF_8))
  }
}
