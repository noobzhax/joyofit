package com.joyodigitama.huaweiwear

/**
 * Which build this is: "play" (Google Play: no SEND_SMS, READ_CALL_LOG or READ_CONTACTS in the manifest) or "sideload"
 * (the APK from the website or a self-build). Set at build time by `JOYOFIT_DISTRIBUTION` (see `build.gradle`).
 */
internal object Distribution {
  val name: String = BuildConfig.DISTRIBUTION

  val isPlay: Boolean get() = name == "play"

  /** The build can send the SOS text message the watch asks for (needs SEND_SMS in the manifest). */
  val canSendSms: Boolean get() = !isPlay

  /** The build can learn the caller's number and name of an incoming call (READ_CALL_LOG, READ_CONTACTS). */
  val canIdentifyCaller: Boolean get() = !isPlay
}
