// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiState (commandsPerService, expandCapabilities,
// supportsTruSleepNewSync, supportsTruSleep, supportsDictSleepSync, supportsBedTime).
package com.joyodigitama.huaweiwear

/**
 * What the connected watch reported during init, shared between [HuaweiInitializer] (writer) and
 * the sync code (reader). Replaced wholesale on each init; [reset] runs when a new init starts.
 */
internal object DeviceCaps {
  /** Commands per service from SupportedCommands (GB HuaweiState.commandsPerService). */
  @Volatile var supportedCommands: Map<Int, ByteArray> = emptyMap()

  /** ExpandCapability bitmap (GB HuaweiState.expandCapabilities); null when the watch sent none. */
  @Volatile var expandCapabilities: ByteArray? = null

  /** SettingRelated tag 0x02 bit 1 (GB HuaweiState.supportsTruSleepNewSync): sleep files via service 0x2C. */
  @Volatile var truSleepNewSync: Boolean = false

  /** SettingRelated tag 0x02 bit 2 (GB HuaweiState.supportsRriNewSync). */
  @Volatile var rriNewSync: Boolean = false

  /** SettingRelated tag 0x02 bit 3 (GB HuaweiState.supportsGpsNewSync). */
  @Volatile var gpsNewSync: Boolean = false

  fun reset() {
    supportedCommands = emptyMap()
    expandCapabilities = null
    truSleepNewSync = false
    rriNewSync = false
    gpsNewSync = false
  }

  /** GB HuaweiState.supportsCommandForService. */
  fun supports(service: Int, command: Int): Boolean =
    supportedCommands[service]?.any { it == command.toByte() } == true

  /** GB HuaweiState.supportsExpandCapability(int): bit `which % 8` of byte `which / 8`. */
  fun expandCapability(which: Int): Boolean {
    val caps = expandCapabilities ?: return false
    if (which >= caps.size * 8) return false
    val bit = 1 shl (which % 8)
    return (caps[which / 8].toInt() and bit) == bit
  }

  /** GB HuaweiState.supportsTruSleep: FitnessData (0x07) command 0x16. */
  val supportsTruSleep: Boolean get() = supports(0x07, 0x16)

  /** GB HuaweiState.supportsDictSleepSync: ExpandCapability bit 143. */
  val supportsDictSleepSync: Boolean get() = expandCapability(143)

  /** GB HuaweiState.supportsBedTime: ExpandCapability bit 199. */
  val supportsBedTime: Boolean get() = expandCapability(199)
}
