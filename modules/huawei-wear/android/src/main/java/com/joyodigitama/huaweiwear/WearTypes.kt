package com.joyodigitama.huaweiwear

import expo.modules.kotlin.exception.CodedException

/** Wire names match `LinkState` in `HuaweiWear.types.ts`. */
internal enum class LinkState(val wire: String) {
  DISCONNECTED("disconnected"),
  CONNECTING("connecting"),
  AUTHENTICATING("authenticating"),
  INITIALIZING("initializing"),
  CONNECTED("connected"),
  SYNCING("syncing"),
}

/** Wire names match `AuthMode` in `HuaweiWear.types.ts`. */
internal enum class AuthMode(val wire: String) {
  NORMAL("normal"),
  HICHAIN_LITE("hichain-lite"),
  HICHAIN("hichain"),
  HICHAIN3("hichain3"),
}

/** Wire names match `LogDirection` in `HuaweiWear.types.ts`. */
internal enum class LogDirection(val wire: String) {
  TX("tx"),
  RX("rx"),
  INFO("info"),
  ERROR("error"),
}

internal object ErrorCodes {
  const val BLUETOOTH_PERMISSION = "ERR_BLUETOOTH_PERMISSION"
  const val BLUETOOTH_UNAVAILABLE = "ERR_BLUETOOTH_UNAVAILABLE"
  const val BLUETOOTH_OFF = "ERR_BLUETOOTH_OFF"
  const val INVALID_ADDRESS = "ERR_INVALID_ADDRESS"
  const val NOT_CONNECTED = "ERR_NOT_CONNECTED"
  const val BUSY = "ERR_BUSY"
  const val CONNECT_FAILED = "ERR_CONNECT_FAILED"
  const val DISCONNECTED = "ERR_DISCONNECTED"
  const val AUTH_FAILED = "ERR_AUTH_FAILED"
  const val DEVICE_STATUS = "ERR_DEVICE_STATUS"
  const val TIMEOUT = "ERR_TIMEOUT"
  const val PROTOCOL = "ERR_PROTOCOL"
  const val STORAGE = "ERR_STORAGE"
  const val INVALID_ARGUMENT = "ERR_INVALID_ARGUMENT"
  const val UNSUPPORTED = "ERR_UNSUPPORTED"
}

/** Every failure surfaced to JS is a [CodedException] with one of [ErrorCodes]. */
internal class WearException(
  val errorCode: String,
  message: String,
  cause: Throwable? = null,
) : CodedException(errorCode, message, cause)

/** Sink for everything the native layer reports; fans out to JS (when running) and the service notification. */
internal interface WearEvents {
  fun state(state: LinkState, error: String?)
  fun battery(level: Int)

  /** A sync finished and its rows are committed to the database. */
  fun syncComplete(summary: SyncSummary)
  fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String)
}
