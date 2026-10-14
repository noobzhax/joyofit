package com.joyodigitama.huaweiwear

import android.app.Activity
import android.os.Bundle
import android.util.TypedValue
import android.widget.ScrollView
import android.widget.TextView

/**
 * What Health Connect shows when the user taps the privacy-policy link of its permission dialog
 * (Android 13 and older) or "View permission usage" (Android 14+, through the manifest alias).
 * Plain framework views: it is not part of the React app and needs no theme library.
 */
internal class HealthConnectRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val pad = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20f, resources.displayMetrics).toInt()
    val text = TextView(this).apply {
      setPadding(pad, pad * 2, pad, pad)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      this.text = RATIONALE
    }
    setContentView(ScrollView(this).apply { addView(text) })
  }

  private companion object {
    const val RATIONALE = "WatchFit copies the data your Huawei watch records (steps, distance, active " +
      "energy, heart rate, resting heart rate, blood oxygen, sleep and workouts) into Health Connect, " +
      "so that other apps you allow can read it.\n\n" +
      "WatchFit only writes to Health Connect. It never reads other apps' data, has no account and " +
      "no server, and sends nothing over the internet. The data stays on this phone. You can switch " +
      "the export off in WatchFit's Settings, and delete what was written from Health Connect."
  }
}
