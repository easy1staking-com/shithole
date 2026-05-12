plugins {
    java
    id("org.springframework.boot") version "3.3.4"
    id("io.spring.dependency-management") version "1.1.6"
}

group = "com.easy1staking.shithole"
version = "0.0.1-SNAPSHOT"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

configurations {
    compileOnly {
        extendsFrom(configurations.annotationProcessor.get())
    }
}

repositories {
    mavenCentral()
    mavenLocal()
}

dependencies {
    // Spring Boot starters
    implementation("org.springframework.boot:spring-boot-starter")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    testImplementation("org.springframework.boot:spring-boot-starter-test")

    // Cardano Client Lib (CCL) — pre-release pinned for the blueprint annotation processor.
    // 0.7.1's processor mis-generates Option<a> imports (`option<cardano…>` literal in source).
    // 0.8.0-pre3+ fixes that.
    implementation("com.bloxbean.cardano:cardano-client-lib:0.8.0-pre4")
    implementation("com.bloxbean.cardano:cardano-client-backend-blockfrost:0.8.0-pre4")
    implementation("com.bloxbean.cardano:cardano-client-backend-ogmios:0.8.0-pre4")

    // CCL annotation processor for blueprint-driven model generation from contracts/plutus.json
    compileOnly("com.bloxbean.cardano:cardano-client-annotation-processor:0.8.0-pre4")
    annotationProcessor("com.bloxbean.cardano:cardano-client-annotation-processor:0.8.0-pre4")

    // Yaci Store — auto-indexes UTxOs into our Postgres
    implementation("com.bloxbean.cardano:yaci-store-spring-boot-starter:2.1.0-pre3")
    implementation("com.bloxbean.cardano:yaci-store-utxo-spring-boot-starter:2.1.0-pre3")

    // DB
    implementation("org.postgresql:postgresql:42.7.2")
    testImplementation("com.h2database:h2:2.2.220")

    // Lombok
    compileOnly("org.projectlombok:lombok:1.18.30")
    annotationProcessor("org.projectlombok:lombok:1.18.30")
    testCompileOnly("org.projectlombok:lombok:1.18.30")
    testAnnotationProcessor("org.projectlombok:lombok:1.18.30")

    // Observability
    implementation("io.micrometer:micrometer-registry-prometheus:1.13.5")
}

tasks.named<Test>("test") {
    useJUnitPlatform()
}
