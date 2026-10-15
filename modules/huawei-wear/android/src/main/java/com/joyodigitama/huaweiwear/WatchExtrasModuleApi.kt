package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** `CycleSwitches` in `HuaweiWear.types.ts`. */
class CycleSwitchesRecord : Record {
  @Field var master: Boolean = false
  @Field var periodStart: Boolean = true
  @Field var periodEnd: Boolean = true
  @Field var fertileStart: Boolean = true
  @Field var fertileEnd: Boolean = false
  @Field var easyPregnancy: Boolean = false

  internal fun toData() = MenstrualCodec.Switches(master, periodStart, periodEnd, fertileStart, fertileEnd, easyPregnancy)
}

/**
 * Fall detection, SOS SMS relay, sleep report and cycle calendar of the `HuaweiWear` module (`getSafety` ... `logCycleDay`
 * in `HuaweiWearModule.ts`). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.watchExtrasApi(runtime: () -> WearRuntime) {
  Function("getSafety") {
    runtime().extras.safetyStatus()
  }

  AsyncFunction("setFallDetection") Coroutine { enabled: Boolean ->
    runtime().extras.safety.setFall(enabled)
  }

  AsyncFunction("queryFallDetection") Coroutine { ->
    runtime().extras.safety.queryFall()
  }

  AsyncFunction("setSosRelayEnabled") { enabled: Boolean ->
    if (enabled && !Distribution.canSendSms) {
      throw WearException(ErrorCodes.UNSUPPORTED, "This version of JoyoFit (Google Play) cannot send text messages")
    }
    runtime().extras.settings.sosRelayEnabled = enabled
    runtime().sink.log(LogDirection.INFO, null, null, null, "SOS relay: switched ${if (enabled) "ON" else "OFF"} by the user")
  }

  Function("testSosRelay") {
    runtime().extras.safety.testRelay()
  }

  AsyncFunction("setSleepReportEnabled") { enabled: Boolean ->
    runtime().extras.settings.sleepReportEnabled = enabled
  }

  AsyncFunction("sendSleepReportNow") Coroutine { ->
    runtime().extras.sleepReport.push(force = true)
  }

  AsyncFunction("getCycle") Coroutine { ->
    withContext(Dispatchers.IO) { runtime().extras.menstrual.overview() }
  }

  AsyncFunction("setCycleEnabled") { enabled: Boolean ->
    runtime().extras.menstrual.setEnabled(enabled)
  }

  AsyncFunction("setCycleSwitches") { switches: CycleSwitchesRecord ->
    runtime().extras.menstrual.setSwitches(switches.toData())
  }

  AsyncFunction("startPeriod") Coroutine { day: String ->
    withContext(Dispatchers.IO) { runtime().extras.menstrual.startPeriod(day) }
  }

  AsyncFunction("endPeriod") Coroutine { day: String ->
    withContext(Dispatchers.IO) { runtime().extras.menstrual.endPeriod(day) }
  }

  AsyncFunction("addPeriod") Coroutine { start: String, end: String ->
    withContext(Dispatchers.IO) { runtime().extras.menstrual.addPeriod(start, end) }
  }

  AsyncFunction("deletePeriod") Coroutine { start: String ->
    withContext(Dispatchers.IO) { runtime().extras.menstrual.deletePeriod(start) }
  }

  AsyncFunction("logCycleDay") Coroutine { day: String, flow: Int, cramps: Int ->
    withContext(Dispatchers.IO) { runtime().extras.menstrual.logDay(day, flow, cramps) }
  }
}
