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
    const val RATIONALE = "JoyoFit copies the data your Huawei watch records (steps, distance, active " +
      "energy, heart rate, resting heart rate, blood oxygen, sleep and workouts) into Health Connect, " +
      "so that other apps you allow can read it.\n\n" +
      "JoyoFit only writes to Health Connect. It never reads other apps' data. Writing to Health " +
      "Connect does not send anything over the internet and the data is not shared with anyone; " +
      "it is not used for advertising. Other JoyoFit features that use the internet (weather, the " +
      "optional cloud) are described in the privacy policy at https://fit.joyorogo.com/privasi. " +
      "You can switch the export off in JoyoFit's Settings, and delete what was written from Health Connect."
  }
}
