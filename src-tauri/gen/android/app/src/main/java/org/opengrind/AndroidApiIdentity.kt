package org.opengrind

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.hardware.display.DisplayManager
import android.view.Display
import androidx.annotation.Keep
import org.json.JSONObject
import java.util.TimeZone

@Keep
object AndroidApiIdentity {
	@Keep
	fun snapshot(context: Context): String {
		val resources = context.resources
		val displayMode = context
			.getSystemService(DisplayManager::class.java)
			.getDisplay(Display.DEFAULT_DISPLAY)
			?.mode
		val display = resources.displayMetrics
		val width = displayMode?.physicalWidth ?: display.widthPixels
		val height = displayMode?.physicalHeight ?: display.heightPixels
		val longEdge = maxOf(width, height)
		val shortEdge = minOf(width, height)
		val locale = resources.configuration.locales[0]
		val memory = ActivityManager.MemoryInfo().also { info ->
			context.getSystemService(ActivityManager::class.java).getMemoryInfo(info)
		}
		val localeName = buildString {
			append(locale.language)
			if (locale.country.isNotBlank()) {
				append('_')
				append(locale.country)
			}
		}

		return JSONObject()
			.put("os", "Android ${Build.VERSION.RELEASE}")
			.put("deviceModel", Build.MODEL)
			.put("manufacturer", Build.MANUFACTURER)
			.put("screenResolution", "${longEdge}x${shortEdge}")
			.put("totalRam", memory.totalMem.toString())
			.put("timezone", TimeZone.getDefault().id)
			.put("locale", localeName)
			.put("acceptLanguage", locale.toLanguageTag())
			.toString()
	}
}
