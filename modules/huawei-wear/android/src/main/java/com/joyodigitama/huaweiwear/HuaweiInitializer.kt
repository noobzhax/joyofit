// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.initializeDeviceConfigure and
// service/devices/huawei/requests/{GetProductInformation,SetTime,GetBatteryLevel,GetSupportedServices,GetSupportedCommands}Request.
package com.joyodigitama.huaweiwear

import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DeviceConfig

internal class InitResult(
  val productModel: String?,
  val softwareVersion: String?,
  val hardwareVersion: String?,
  val serialNumber: String?,
  val deviceName: String?,
  val batteryLevel: Int?,
)

/**
 * Port of HuaweiSupportProvider.initializeDeviceConfigure for a BR device:
 * ProductInfo -> SetTime (get, set again if drifted) -> BatteryLevel -> SupportedServices ->
 * SupportedCommands. Each request has GB's 2 s `initTimeout`; like GB, a missing reply only skips
 * to the next request.
 */
internal class HuaweiInitializer(
  private val session: HuaweiSession,
  private val events: WearEvents,
) {
  private val params get() = session.params

  suspend fun run(): InitResult {
    var productModel: String? = null
    var softwareVersion: String? = null
    var hardwareVersion: String? = null
    var serialNumber: String? = null
    var deviceName: String? = null
    var battery: Int? = null

    // GetProductInformationRequest
    soft("ProductInfo") {
      val response = session
        .request(DeviceConfig.ProductInfo.Request(params, HuaweiDeviceType.BR), Timeouts.INIT_MS, "ProductInfo")
        .expect<DeviceConfig.ProductInfo.Response>("ProductInfo")
      softwareVersion = response.softwareVersion
      hardwareVersion = response.hardwareVersion
      productModel = response.productModel
      serialNumber = response.serialNumber
      deviceName = response.deviceName
      events.log(
        LogDirection.INFO,
        null,
        null,
        null,
        "ProductInfo: model=$productModel software=$softwareVersion hardware=$hardwareVersion " +
          "serial=$serialNumber name=$deviceName package=${response.packageName} region=${response.regionCode}",
      )
    }

    // SetTimeRequest(syncTime = true): read the watch clock, send the time again if it differs.
    soft("SetTime") {
      val response = session
        .request(DeviceConfig.TimeRequest(params), Timeouts.INIT_MS, "SetTime")
        .expect<DeviceConfig.TimeRequest.Response>("SetTime")
      val deviceTime = response.deviceTime
      val systemTime = (System.currentTimeMillis() / 1000).toInt()
      val diff = abs(systemTime - deviceTime)
      events.log(LogDirection.INFO, null, null, null, "SetTime: systemTime=$systemTime deviceTime=$deviceTime diff=$diff")
      if (diff > 0) {
        session
          .request(DeviceConfig.TimeRequest(params), Timeouts.INIT_MS, "SetTime (apply)")
          .expect<DeviceConfig.TimeRequest.Response>("SetTime (apply)")
      }
    }

    // GetBatteryLevelRequest
    soft("BatteryLevel") {
      battery = session.queryBattery(Timeouts.INIT_MS)
      events.log(LogDirection.INFO, null, null, null, "BatteryLevel: $battery%")
    }

    // GetSupportedServicesRequest, then GetSupportedCommandsRequest for what it activates.
    soft("SupportedServices") {
      val known = DeviceConfig.SupportedServices.knownSupportedServices
      val response = session
        .request(DeviceConfig.SupportedServices.Request(params, known), Timeouts.INIT_MS, "SupportedServices")
        .expect<DeviceConfig.SupportedServices.Response>("SupportedServices")
      val supported: ByteArray = response.supportedServices

      val activated = ArrayList<Byte>()
      activated.add(0x01.toByte()) // device always supports service 1
      for (i in 0 until minOf(supported.size, known.size)) {
        if (supported[i].toInt() == 1) activated.add(known[i])
      }
      events.log(
        LogDirection.INFO,
        null,
        null,
        null,
        "SupportedServices: " + activated.joinToString(" ") { it.hex2() },
      )
      supportedCommands(activated)
    }

    return InitResult(productModel, softwareVersion, hardwareVersion, serialNumber, deviceName, battery)
  }

  /** GetSupportedCommandsRequest: as many services per request as fit, repeated until none are left. */
  private suspend fun supportedCommands(activated: MutableList<Byte>) {
    val commandsPerService = DeviceConfig.SupportedCommands.commandsPerService
    // GB would NPE on a service without a known command table; those are skipped.
    activated.removeAll { service ->
      val unknown = commandsPerService[service.toInt()] == null
      if (unknown) {
        events.log(LogDirection.INFO, null, null, null, "SupportedCommands: no command table for service ${service.hex2()}, skipped")
      }
      unknown
    }
    var requestNumber = 0
    var serviceCount = 0
    while (activated.isNotEmpty()) {
      val request = DeviceConfig.SupportedCommands.Request(params)
      var nextService = activated.removeAt(0)
      var fits = request.addCommandsForService(nextService, commandsPerService.getValue(nextService.toInt()))
      if (!fits) {
        // Not even one service fits an empty request; GB would resend the same empty request forever.
        events.log(LogDirection.ERROR, null, null, null, "SupportedCommands: service ${nextService.hex2()} does not fit a request, skipped")
        continue
      }
      while (fits && activated.isNotEmpty()) {
        nextService = activated.removeAt(0)
        fits = request.addCommandsForService(nextService, commandsPerService.getValue(nextService.toInt()))
      }
      if (!fits) activated.add(0, nextService) // put the extra back

      requestNumber++
      val response = session
        .request(request, Timeouts.QUERY_MS, "SupportedCommands #$requestNumber")
        .expect<DeviceConfig.SupportedCommands.Response>("SupportedCommands #$requestNumber")
      serviceCount += response.commandsLists.size
    }
    events.log(LogDirection.INFO, null, null, null, "SupportedCommands: $serviceCount services in $requestNumber request(s)")
  }

  private suspend fun soft(label: String, block: suspend () -> Unit) {
    try {
      block()
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      events.log(LogDirection.ERROR, null, null, null, "$label skipped: ${e.message}")
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "$label skipped: ${e.message ?: e.javaClass.simpleName}")
    }
  }
}

/** GetBatteryLevelRequest: the first battery level (watches report a single one). */
internal suspend fun HuaweiSession.queryBattery(timeoutMs: Long): Int {
  val response = request(DeviceConfig.BatteryLevel.Request(params), timeoutMs, "BatteryLevel")
    .expect<DeviceConfig.BatteryLevel.Response>("BatteryLevel")
  val multi: ByteArray? = response.multi_level
  return if (multi == null || multi.isEmpty()) {
    response.level.toInt() and 0xFF
  } else {
    multi[0].toInt() and 0xFF
  }
}
