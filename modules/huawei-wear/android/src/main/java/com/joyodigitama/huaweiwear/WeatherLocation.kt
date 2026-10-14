package com.joyodigitama.huaweiwear

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Looper
import java.util.Locale
import java.util.function.Consumer
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** No usable position: [permissionMissing] tells "not allowed" from "the phone has none". */
internal class WeatherLocationException(message: String, val permissionMissing: Boolean) : Exception(message)

/**
 * The phone's coarse position without Google Play services: `LocationManager` only.
 *
 * 1. The newest last-known fix of the enabled providers, if it is under [FRESH_MS] old.
 * 2. Otherwise one fresh network/fused fix (waits up to [FIX_TIMEOUT_MS]).
 * 3. Otherwise the stale last-known fix, then the position stored by the previous successful call.
 *
 * Only ACCESS_COARSE_LOCATION is requested, so the GPS provider is never used. Without background
 * location access (Android 10+) the service may get no fresh fix; steps 1 and 3 still answer.
 */
internal class WeatherLocation(context: Context, private val settings: WeatherSettings, private val log: (String) -> Unit) {
  private val appContext = context.applicationContext

  fun hasPermission(): Boolean =
    appContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  suspend fun current(): WeatherPlace {
    if (!hasPermission()) {
      throw WeatherLocationException("Location permission is not granted", permissionMissing = true)
    }
    val manager = appContext.getSystemService(LocationManager::class.java)
      ?: throw WeatherLocationException("This device has no location service", permissionMissing = false)

    val lastKnown = newestLastKnown(manager)
    var fix: Location? = lastKnown
    if (lastKnown == null || System.currentTimeMillis() - lastKnown.time > FRESH_MS) {
      val fresh = withTimeoutOrNull(FIX_TIMEOUT_MS) { singleFix(manager) }
      if (fresh != null) fix = fresh else log("Weather: no fresh location fix, using ${if (lastKnown != null) "the last known one" else "the stored position"}")
    }
    if (fix == null) {
      val stored = settings.lastFix
        ?: throw WeatherLocationException("No location is available yet; open the app with location on, or choose a city", permissionMissing = false)
      return stored
    }
    return place(fix)
  }

  /** Names the fix, reusing the stored name when the phone barely moved, and stores it. */
  private suspend fun place(fix: Location): WeatherPlace {
    val previous = settings.lastFix
    val name = if (previous?.name != null && distanceKm(previous.latitude, previous.longitude, fix.latitude, fix.longitude) < REUSE_NAME_KM) {
      previous.name
    } else {
      reverseName(fix.latitude, fix.longitude)
    }
    return WeatherPlace(name, fix.latitude, fix.longitude).also { settings.lastFix = it }
  }

  @android.annotation.SuppressLint("MissingPermission")
  private fun newestLastKnown(manager: LocationManager): Location? {
    var best: Location? = null
    for (provider in manager.getProviders(true)) {
      // GPS needs the fine permission; skip it rather than catch the SecurityException per provider.
      if (provider == LocationManager.GPS_PROVIDER && !hasFine()) continue
      val location = try {
        manager.getLastKnownLocation(provider)
      } catch (e: SecurityException) {
        null
      } catch (e: IllegalArgumentException) {
        null
      }
      if (location != null && (best == null || location.time > best.time)) best = location
    }
    return best
  }

  private fun hasFine() =
    appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  @android.annotation.SuppressLint("MissingPermission")
  private suspend fun singleFix(manager: LocationManager): Location? {
    val provider = when {
      manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.isProviderEnabled(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
      hasFine() && manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
      else -> return null
    }
    return try {
      suspendCancellableCoroutine<Location?> { continuation ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          val signal = CancellationSignal()
          continuation.invokeOnCancellation { signal.cancel() }
          manager.getCurrentLocation(provider, signal, appContext.mainExecutor, Consumer { location -> continuation.resume(location) })
        } else {
          val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
              if (continuation.isActive) continuation.resume(location)
            }

            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {
              if (continuation.isActive) continuation.resume(null)
            }
          }
          continuation.invokeOnCancellation { manager.removeUpdates(listener) }
          @Suppress("DEPRECATION")
          manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
        }
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: SecurityException) {
      null
    }
  }

  /** `Geocoder` needs a backend on the phone; without one the position stays unnamed. */
  private suspend fun reverseName(latitude: Double, longitude: Double): String? {
    if (!Geocoder.isPresent()) return null
    return try {
      withTimeoutOrNull(GEOCODE_TIMEOUT_MS) {
        val geocoder = Geocoder(appContext, Locale.getDefault())
        val address = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          suspendCancellableCoroutine<android.location.Address?> { continuation ->
            geocoder.getFromLocation(
              latitude,
              longitude,
              1,
              object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<android.location.Address>) {
                  continuation.resume(addresses.firstOrNull())
                }

                override fun onError(errorMessage: String?) {
                  continuation.resume(null)
                }
              },
            )
          }
        } else {
          withContext(Dispatchers.IO) {
            @Suppress("DEPRECATION")
            geocoder.getFromLocation(latitude, longitude, 1)?.firstOrNull()
          }
        }
        address?.let { it.locality ?: it.subAdminArea ?: it.adminArea }
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      null
    }
  }

  companion object {
    /** A last-known fix younger than this is used as is. */
    const val FRESH_MS = 60 * 60_000L
    const val FIX_TIMEOUT_MS = 15_000L
    private const val GEOCODE_TIMEOUT_MS = 5_000L

    /** Moving less than this keeps the stored place name. */
    private const val REUSE_NAME_KM = 5.0

    fun distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
      val result = FloatArray(1)
      Location.distanceBetween(lat1, lon1, lat2, lon2, result)
      return result[0] / 1000.0
    }
  }
}
