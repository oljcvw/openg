import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

fun prop(key: String): String =
    project.findProperty(key)?.toString()
        ?: error("Missing required property `$key`. " +
            "Add it to src-tauri/android/gradle.properties.")

fun expandHome(path: String): String =
    if (path == "~" || path.startsWith("~/")) {
        System.getProperty("user.home") + path.substring(1)
    } else path

val keystorePropertiesFile = rootProject.file("keystore.properties")
val hasKeystore = keystorePropertiesFile.exists()
val agoraAppId = providers.gradleProperty("OPEN_GRIND_AGORA_APP_ID")
    .orElse(providers.environmentVariable("OPEN_GRIND_AGORA_APP_ID"))
    .get()
require(agoraAppId.matches(Regex("[0-9a-fA-F]{32}"))) {
    "OPEN_GRIND_AGORA_APP_ID must contain exactly 32 hexadecimal characters"
}
val generatedWatermarkResDir = layout.buildDirectory.dir("generated/openGrindWatermark/res")
val generatedWatermarkResPath = generatedWatermarkResDir.get().asFile
val configuredWatermarkPath = providers.environmentVariable("OPEN_GRIND_CAPTURE_WATERMARK_ASSET")
    .orElse("")
    .get()
    .let(::expandHome)
val configuredWatermarkFile = configuredWatermarkPath.takeIf(String::isNotBlank)?.let(::File)
val generateOpenGrindWatermark by tasks.registering(Sync::class) {
    inputs.property("configuredAsset", configuredWatermarkPath)
    into(File(generatedWatermarkResPath, "drawable"))
    configuredWatermarkFile?.let { source ->
        require(source.isFile) {
            "OPEN_GRIND_CAPTURE_WATERMARK_ASSET does not reference a readable file"
        }
        require(source.extension.lowercase() in setOf("jpg", "jpeg", "png", "webp", "xml")) {
            "OPEN_GRIND_CAPTURE_WATERMARK_ASSET must be an Android-compatible drawable"
        }
        from(source)
        rename { "capture_watermark.${source.extension.lowercase()}" }
    }
}

android {
    compileSdk = prop("opengrind.android.compileSdk").toInt()
    buildToolsVersion = prop("opengrind.android.buildTools")
    ndkVersion = prop("opengrind.android.ndk")
    namespace = "doctor.andrewcox.opengrind"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "doctor.andrewcox.opengrind"
        minSdk = prop("opengrind.android.minSdk").toInt()
        targetSdk = prop("opengrind.android.targetSdk").toInt()
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
        // Mirror of MIN_CHROMIUM_MAJOR in src-tauri/src/lib.rs.
        buildConfigField("int", "MIN_SUPPORTED_WEBVIEW_MAJOR", "111")
        buildConfigField("String", "OPEN_GRIND_AGORA_APP_ID", "\"${agoraAppId.replace("\"", "\\\"")}\"")
    }
	signingConfigs {
		if (hasKeystore) {
			create("release") {
				val keystoreProperties = Properties()
				keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }

				keyAlias = keystoreProperties["keyAlias"] as String
				keyPassword = keystoreProperties["password"] as String
				storeFile = file(expandHome(keystoreProperties["storeFile"] as String))
				storePassword = keystoreProperties["password"] as String
			}
		}
	}
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
				jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
			if (hasKeystore) {
				signingConfig = signingConfigs.getByName("release")
			}
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
			if (hasKeystore) {
				signingConfig = signingConfigs.getByName("release")
			}
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
    sourceSets.getByName("main").res.srcDir(generatedWatermarkResDir)
}

tasks.named("preBuild").configure {
    dependsOn(generateOpenGrindWatermark)
}

// Reproducibility: disable assets/dexopt/baseline.prof[m] and kotlin-tooling-metadata.json
tasks.whenTaskAdded {
    if (name.contains("ArtProfile") || name == "buildKotlinToolingMetadata") {
        enabled = false
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // 2.11.x is compiled with Kotlin 2.1 metadata; this project is pinned to
    // Kotlin 1.9.25. 2.10.5 is the newest WorkManager line compatible with it.
    implementation("androidx.work:work-runtime:2.10.5")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-video:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("com.vanniktech:android-image-cropper:4.5.0")
    implementation("io.agora.rtc:full-sdk:4.6.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

if (file("tauri.build.gradle.kts").exists()) {
    apply(from = "tauri.build.gradle.kts")
}
