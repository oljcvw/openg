package doctor.andrewcox.opengrind.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.drawable.Drawable
import androidx.annotation.DrawableRes
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import androidx.exifinterface.media.ExifInterface
import doctor.andrewcox.opengrind.R
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

internal data class ProcessedPhoto(
	val bytes: ByteArray,
	val width: Int,
	val height: Int,
)

internal class CapturedImageProcessor(private val context: Context) {
	fun process(source: File): ProcessedPhoto {
		val bitmap = decodeBounded(source)
		val oriented = applyExifOrientation(bitmap, ExifInterface(source))
		if (oriented !== bitmap) bitmap.recycle()
		val watermarked = applyWatermark(oriented)
		if (watermarked !== oriented) oriented.recycle()
		return compressToLimit(watermarked).also { watermarked.recycle() }
	}

	private fun decodeBounded(source: File): Bitmap {
		val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
		BitmapFactory.decodeFile(source.absolutePath, bounds)
		require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Captured photo cannot be decoded" }

		var sampleSize = 1
		while (bounds.outWidth / sampleSize > MAX_DIMENSION * 2 ||
			bounds.outHeight / sampleSize > MAX_DIMENSION * 2
		) {
			sampleSize *= 2
		}
		val decoded = BitmapFactory.decodeFile(
			source.absolutePath,
			BitmapFactory.Options().apply {
				inSampleSize = sampleSize
				inPreferredConfig = Bitmap.Config.ARGB_8888
			},
		) ?: error("Captured photo cannot be decoded")
		return scaleToBounds(decoded, MAX_DIMENSION)
	}

	private fun applyExifOrientation(bitmap: Bitmap, exif: ExifInterface): Bitmap {
		val matrix = Matrix()
		when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
			ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
			ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
			ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
			ExifInterface.ORIENTATION_TRANSPOSE -> {
				matrix.setRotate(90f)
				matrix.postScale(-1f, 1f)
			}
			ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
			ExifInterface.ORIENTATION_TRANSVERSE -> {
				matrix.setRotate(-90f)
				matrix.postScale(-1f, 1f)
			}
			ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
			else -> return bitmap
		}
		return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
	}

	private fun applyWatermark(source: Bitmap): Bitmap {
		val drawable = ContextCompat.getDrawable(context, configuredWatermarkResource()) ?: return source
		val output = source.copy(Bitmap.Config.ARGB_8888, true)
		val maxWidth = max(1, (source.width * WATERMARK_MAX_WIDTH_RATIO).roundToInt())
		val intrinsicWidth = max(1, drawable.intrinsicWidth)
		val intrinsicHeight = max(1, drawable.intrinsicHeight)
		val width = minOf(maxWidth, intrinsicWidth)
		val height = max(1, (intrinsicHeight * (width.toFloat() / intrinsicWidth)).roundToInt())
		val watermark = drawable.toBitmap(width, height, Bitmap.Config.ARGB_8888)
		val margin = max(8, (source.width * WATERMARK_MARGIN_RATIO).roundToInt())
		Canvas(output).drawBitmap(
			watermark,
			(source.width - width - margin).toFloat(),
			(source.height - height - margin).toFloat(),
			Paint(Paint.ANTI_ALIAS_FLAG).apply { alpha = WATERMARK_ALPHA },
		)
		watermark.recycle()
		return output
	}

	@DrawableRes
	private fun configuredWatermarkResource(): Int {
		val configured = context.resources.getIdentifier(
			"capture_watermark",
			"drawable",
			context.packageName,
		)
		return configured.takeIf { it != 0 } ?: R.drawable.capture_watermark_fallback
	}

	private fun compressToLimit(source: Bitmap): ProcessedPhoto {
		var current = source
		try {
			repeat(MAX_SCALE_ITERATIONS + 1) { iteration ->
				val bytes = ByteArrayOutputStream().use { output ->
					check(current.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output))
					output.toByteArray()
				}
				if (bytes.size <= MAX_JPEG_BYTES) {
					return ProcessedPhoto(bytes, current.width, current.height)
				}
				if (iteration == MAX_SCALE_ITERATIONS) {
					error("Captured photo cannot be reduced below 1 MiB")
				}
				val scale = jpegScaleFactor(bytes.size)
				val scaled = Bitmap.createScaledBitmap(
					current,
					max(1, (current.width * scale).roundToInt()),
					max(1, (current.height * scale).roundToInt()),
					true,
				)
				if (current !== source) current.recycle()
				current = scaled
			}
			error("Unreachable")
		} finally {
			if (current !== source) current.recycle()
		}
	}

	private fun scaleToBounds(bitmap: Bitmap, maximum: Int): Bitmap {
		if (bitmap.width <= maximum && bitmap.height <= maximum) return bitmap
		val scale = maximum.toFloat() / max(bitmap.width, bitmap.height)
		val scaled = Bitmap.createScaledBitmap(
			bitmap,
			max(1, (bitmap.width * scale).roundToInt()),
			max(1, (bitmap.height * scale).roundToInt()),
			true,
		)
		bitmap.recycle()
		return scaled
	}

	companion object {
		const val MAX_DIMENSION = 1_024
		const val MAX_JPEG_BYTES = 1_048_576
		const val MAX_SCALE_ITERATIONS = 4
		const val JPEG_QUALITY = 100
		private const val WATERMARK_MAX_WIDTH_RATIO = 0.18f
		private const val WATERMARK_MARGIN_RATIO = 0.025f
		private const val WATERMARK_ALPHA = 210

		internal fun jpegScaleFactor(byteCount: Int): Float =
			sqrt(MAX_JPEG_BYTES / (byteCount + 0.1f)).coerceIn(0.1f, 0.95f)
	}
}
