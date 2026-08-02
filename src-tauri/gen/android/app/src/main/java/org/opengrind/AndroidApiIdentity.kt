package org.opengrind

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import androidx.annotation.Keep
import org.json.JSONObject
import java.util.TimeZone

@Keep
object AndroidApiIdentity {
	@Keep
	fun snapshot(context: Context): String {
		val resources = context.resources
		val display = resources.displayMetrics
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
			.put("screenResolution", "${display.heightPixels}x${display.widthPixels}")
			.put("totalRam", memory.totalMem.toString())
			.put("timezone", TimeZone.getDefault().id)
			.put("locale", localeName)
			.put("acceptLanguage", locale.toLanguageTag())
			.toString()
	}
}
