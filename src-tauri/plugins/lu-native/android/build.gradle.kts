plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.purpledoubled.lunative"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.appcompat:appcompat:1.6.0")
    implementation("androidx.activity:activity-ktx:1.7.0")
    implementation(project(":tauri-android"))
    // Round 57: reads the QR code in a photo of the system camera. Pure Java, no Google services.
    implementation("com.google.zxing:core:3.5.3")
    // NetGuardTest: the address rule against testdata/net-vectors.tsv.
    testImplementation("junit:junit:4.13.2")
}
