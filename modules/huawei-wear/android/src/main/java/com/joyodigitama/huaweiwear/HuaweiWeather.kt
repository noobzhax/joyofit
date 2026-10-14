// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiWeatherManager.{sendWeather,fixupWeather,handleAsyncMessage} and
// service/devices/huawei/requests/SendWeather{Start,Unit,Support,ExtendedSupport,SunMoonSupport,Current,Forecast,Error,Device}Request,
// SendGpsAndTimeToDeviceRequest, devices/huawei/packets/GpsAndTime.CurrentGPSRequest.
package com.joyodigitama.huaweiwear

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneId
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Weather

/** GpsAndTime (service 0x18) command 0x07: the phone's position and a timestamp, sent after the current weather. */
internal class CurrentGpsRequest(params: HuaweiPacket.ParamsProvider, timestamp: Int, latitude: Double, longitude: Double) : HuaweiPacket(params) {
  init {
    serviceId = GPS_AND_TIME_ID
    commandId = COMMAND_ID
    tlv = HuaweiTLV().put(0x01, timestamp).put(0x02, latitude).put(0x03, longitude)
    isEncrypted = true
    complete = true
  }

  companion object {
    const val GPS_AND_TIME_ID: Byte = 0x18
    const val COMMAND_ID: Byte = 0x07
  }
}

/** Builds GB's weather packets from a [WeatherReport]; no I/O, so it is testable on the JVM. */
internal object WeatherPackets {
  /** Whole degrees, clamped to the signed byte the watch takes. */
  fun temperatureByte(celsius: Double): Byte = Math.round(celsius).coerceIn(-128L, 127L).toByte()

  /** Hours the forecast request carries (SendWeatherForecastRequest). */
  const val MAX_HOURS = 24

  /** Days including today (SendWeatherForecastRequest). */
  const val MAX_DAYS = 8

  /**
   * SendWeatherCurrentRequest. Temperatures are always Celsius, like GB (`K - 273`); the unit tag
   * (0x0a) is what tells the watch to display Fahrenheit.
   */
  fun current(params: HuaweiPacket.ParamsProvider, settings: Weather.Settings, report: WeatherReport, unit: TemperatureUnit): HuaweiPacket {
    val today = report.daily.first()
    return Weather.CurrentWeatherRequest(
      params,
      settings,
      WeatherIcons.forWmo(report.code),
      report.windDirection,
      Beaufort.fromKmh(report.windSpeedKmh).toByte(),
      temperatureByte(today.minC),
      temperatureByte(today.maxC),
      null, // pm25: Open-Meteo's forecast API has no air quality
      report.place.name,
      temperatureByte(report.tempC),
      unitOf(unit),
      null, // air quality index
      report.observedAtSec,
      report.uvIndex?.toFloat(),
      SOURCE_NAME,
      report.humidity.coerceIn(0, 100).toByte(),
      Math.round(report.windSpeedKmh).toInt(),
      Math.round(report.feelsLikeC).toInt(),
    )
  }

  /**
   * SendWeatherForecastRequest after GB's fixupWeather: the next 24 hours, then today (current icon,
   * as GB does) and up to seven more days. Open-Meteo has no moon times, so they are 0 and skipped by
   * the packet; the moon phase is computed ([Moon]).
   */
  fun forecast(
    params: HuaweiPacket.ParamsProvider,
    settings: Weather.Settings,
    report: WeatherReport,
    nowSec: Long,
    zone: ZoneId,
  ): HuaweiPacket {
    val hours = report.hourly.filter { it.timestamp > nowSec }.take(MAX_HOURS).map { hour ->
      Weather.WeatherForecastData.TimeData().apply {
        timestamp = hour.timestamp
        icon = WeatherIcons.forWmo(hour.code)
        temperature = temperatureByte(hour.tempC)
        precipitation = (hour.precipProbability ?: 0).coerceIn(0, 100).toByte()
        uvIndex = Math.round(hour.uvIndex ?: 0.0).coerceIn(0L, 127L).toByte()
      }
    }

    val dayCount = minOf(report.daily.size, MAX_DAYS)
    val days = ArrayList<Weather.WeatherForecastData.DayData>(dayCount)
    val today = report.daily.first()
    val todayStart = zone.dayStartSec(nowSec, 0)
    days.add(
      day(
        timestamp = report.observedAtSec,
        code = report.code,
        source = today,
        sunrise = sunInDay(today.sunrise, zone, nowSec, 0),
        sunset = sunInDay(today.sunset, zone, nowSec, 0),
        moonPhaseAt = todayStart + 12 * 3600L,
      ),
    )
    for (i in 1 until dayCount) {
      val forecast = report.daily[i]
      days.add(
        day(
          // GB: the observation time plus whole days, not the day's own midnight.
          timestamp = report.observedAtSec + 24 * 3600 * i,
          code = forecast.code,
          source = forecast,
          sunrise = sunInDay(forecast.sunrise, zone, nowSec, i),
          sunset = sunInDay(forecast.sunset, zone, nowSec, i),
          moonPhaseAt = zone.dayStartSec(nowSec, i) + 12 * 3600L,
        ),
      )
    }
    return Weather.WeatherForecastData.Request(params, settings, hours, days)
  }

  private fun day(
    timestamp: Int,
    code: Int,
    source: WeatherDay,
    sunrise: Int,
    sunset: Int,
    moonPhaseAt: Long,
  ) = Weather.WeatherForecastData.DayData().apply {
    this.timestamp = timestamp
    icon = WeatherIcons.forWmo(code)
    highTemperature = temperatureByte(source.maxC)
    lowTemperature = temperatureByte(source.minC)
    sunriseTime = sunrise
    sunsetTime = sunset
    moonRiseTime = 0
    moonSetTime = 0
    moonPhase = Weather.degreesToMoonPhase(Moon.phaseDegrees(moonPhaseAt))
  }

  /**
   * GB fixupWeather: "if this is wrong the watch does not display any weather data at all", so a sun
   * time outside the local day it belongs to (`day` days after today) is sent as 0.
   */
  fun sunInDay(timeSec: Int, zone: ZoneId, nowSec: Long, day: Int): Int {
    if (timeSec == 0) return 0
    val start = zone.dayStartSec(nowSec, day)
    val end = zone.dayStartSec(nowSec, day + 1)
    // GB timeOutOfDateInterval: out when check <= start or check > end.
    return if (timeSec <= start || timeSec > end) 0 else timeSec
  }

  private fun ZoneId.dayStartSec(nowSec: Long, plusDays: Int): Long =
    Instant.ofEpochSecond(nowSec).atZone(this).toLocalDate().plusDays(plusDays.toLong()).atStartOfDay(this).toEpochSecond()

  private fun unitOf(unit: TemperatureUnit) =
    if (unit == TemperatureUnit.FAHRENHEIT) Weather.HuaweiTemperatureFormat.FAHRENHEIT else Weather.HuaweiTemperatureFormat.CELSIUS

  /** SendWeatherCurrentRequest: GB passes its app name as the source. */
  const val SOURCE_NAME = "Open-Meteo"

  /** SendWeatherErrorRequest: the extended packet when the watch lists 0f/0c, else the simple one (0f/07). */
  fun error(params: HuaweiPacket.ParamsProvider, code: Weather.ErrorCode): HuaweiPacket? = when {
    DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherErrorExtended.id.toInt()) -> Weather.WeatherErrorExtended.Request(params, code, false)
    DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherErrorSimple.id.toInt()) -> Weather.WeatherErrorSimple.Request(params, code)
    else -> null
  }

  /** GB rounds the position to 7 decimals and back-dates the timestamp by a day so a workout's GPS wins. */
  fun gps(params: HuaweiPacket.ParamsProvider, nowSec: Long, place: WeatherPlace): HuaweiPacket {
    val latitude = BigDecimal(place.latitude).setScale(7, RoundingMode.HALF_UP).toDouble()
    val longitude = BigDecimal(place.longitude).setScale(7, RoundingMode.HALF_UP).toDouble()
    return CurrentGpsRequest(params, (nowSec - 86400).toInt(), latitude, longitude)
  }
}

/** The weather packet sequence of GB's HuaweiWeatherManager.sendWeather, over one [HuaweiSession]. */
internal class HuaweiWeatherSender(private val session: HuaweiSession, private val events: WearEvents) {
  private val params get() = session.params

  /** Whether the watch lists the weather service at all (HuaweiState.supportsWeather: 0f/01). */
  fun supported(): Boolean = DeviceCaps.supports(Weather.id.toInt(), Weather.CurrentWeatherRequest.id.toInt())

  /**
   * Start, unit, support flags, current weather, position, forecast, each waiting for the watch's
   * reply like GB's request chain. [zone] is the phone's: it decides which sun times fall in "today".
   */
  suspend fun send(report: WeatherReport, unit: TemperatureUnit, nowSec: Long, zone: ZoneId = ZoneId.systemDefault()) {
    if (!supported()) throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list the weather service (0f/01)")
    val settings = Weather.Settings()
    settings.uvIndexSupported = DeviceCaps.expandCapability(0x2f) // supportsWeatherUvIndex
    settings.extendedHourlyForecast = DeviceCaps.expandCapability(0xc0) // supportsWeatherExtendedHourForecast

    // SendWeatherStartRequest: a non-ok code stops GB's chain.
    val start = ask(Weather.WeatherStart.Request(params), "WeatherStart").expect<Weather.WeatherStart.Response>("WeatherStart")
    if (!start.success) {
      throw WearException(ErrorCodes.PROTOCOL, "WeatherStart: the watch refused (code 0x%08x)".format(start.successCode))
    }
    settings.weatherSupported = true

    if (DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherUnitRequest.id.toInt())) {
      ask(Weather.WeatherUnitRequest(params, if (unit == TemperatureUnit.FAHRENHEIT) Weather.HuaweiTemperatureFormat.FAHRENHEIT else Weather.HuaweiTemperatureFormat.CELSIUS), "WeatherUnit")
    }

    val support = ask(Weather.WeatherSupport.Request(params), "WeatherSupport").expect<Weather.WeatherSupport.Response>("WeatherSupport")
    settings.weatherSupported = support.weatherSupported
    settings.windSupported = support.windSupported
    settings.pm25Supported = support.pm25Supported
    settings.temperatureSupported = support.temperatureSupported
    settings.locationNameSupported = support.locationNameSupported
    settings.currentTemperatureSupported = support.currentTemperatureSupported
    settings.unitSupported = support.unitSupported
    settings.airQualityIndexSupported = support.airQualityIndexSupported
    events.log(LogDirection.INFO, null, null, null, "Weather support bitmap 0x%02x".format(support.supportedBitmap.toInt() and 0xFF))

    if (DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherExtendedSupport.id.toInt())) {
      val extended = ask(Weather.WeatherExtendedSupport.Request(params), "WeatherExtendedSupport")
        .expect<Weather.WeatherExtendedSupport.Response>("WeatherExtendedSupport")
      settings.timeSupported = extended.timeSupported
      settings.sourceSupported = extended.sourceSupported
      settings.weatherIconSupported = extended.weatherIconSupported
      events.log(LogDirection.INFO, null, null, null, "Weather extended bitmap 0x%04x".format(extended.supportedBitmap.toInt() and 0xFFFF))
    }

    if (DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherSunMoonSupport.id.toInt())) {
      val sunMoon = ask(Weather.WeatherSunMoonSupport.Request(params), "WeatherSunMoonSupport")
        .expect<Weather.WeatherSunMoonSupport.Response>("WeatherSunMoonSupport")
      settings.sunRiseSetSupported = sunMoon.sunRiseSetSupported
      settings.moonPhaseSupported = sunMoon.moonPhaseSupported
      events.log(LogDirection.INFO, null, null, null, "Weather sun/moon bitmap 0x%02x".format(sunMoon.supportedBitmap))
    }

    ask(WeatherPackets.current(params, settings, report, unit), "WeatherCurrent")
    events.log(
      LogDirection.INFO, null, null, null,
      "Weather current sent: ${report.place.name ?: "unnamed place"} ${WeatherPackets.temperatureByte(report.tempC)}\u00B0C " +
        "${WeatherIcons.forWmo(report.code)} (WMO ${report.code}), unit ${unit.wire}",
    )

    // SendGpsAndTimeToDeviceRequest: GB sends it by default when the watch lists 0x18/0x06.
    if (DeviceCaps.supports(0x18, 0x06)) {
      try {
        ask(WeatherPackets.gps(params, nowSec, report.place), "WeatherGps")
        events.log(LogDirection.INFO, null, null, null, "Weather position sent to the watch")
      } catch (e: WearException) {
        if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
        events.log(LogDirection.ERROR, null, null, null, "Weather position skipped: ${e.message}")
      }
    }

    if (DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherForecastData.id.toInt())) {
      val forecast = WeatherPackets.forecast(params, settings, report, nowSec, zone)
      ask(forecast, "WeatherForecast")
      events.log(LogDirection.INFO, null, null, null, "Weather forecast sent: ${report.daily.size.coerceAtMost(WeatherPackets.MAX_DAYS)} days, hourly from ${Instant.ofEpochSecond(nowSec)}")
    }
  }

  /** SendWeatherErrorRequest; returns false when the watch lists neither error command. */
  suspend fun sendError(code: Weather.ErrorCode): Boolean {
    val packet = WeatherPackets.error(params, code) ?: return false
    ask(packet, "WeatherError ($code)")
    events.log(LogDirection.INFO, null, null, null, "Weather error sent to the watch: $code")
    return true
  }

  /** SendWeatherDeviceRequest: GB's answer to a watch weather message that is not a request (`addToResponse = false`). */
  suspend fun acknowledge() {
    session.send(Weather.WeatherDeviceRequest(params, HuaweiConstants.RESULT_SUCCESS_INT), "WeatherDeviceRequest ack")
  }

  private suspend fun ask(packet: HuaweiPacket, label: String): HuaweiPacket {
    val response = session.request(packet, Timeouts.QUERY_MS, label)
    val code = response.tlv?.getInteger(0x7f, null)
    if (code != null && code != 0x000186A0) {
      events.log(LogDirection.INFO, null, null, null, "$label: reply code 0x%08x".format(code))
    }
    return response
  }
}
