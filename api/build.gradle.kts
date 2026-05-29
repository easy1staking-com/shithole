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
    implementation("org.springframework.boot:spring-boot-starter-validation")
    testImplementation("org.springframework.boot:spring-boot-starter-test")

    // Cardano Client Lib (CCL) — pre-release pinned for the blueprint annotation processor.
    // 0.7.1's processor mis-generates Option<a> imports (`option<cardano…>` literal in source).
    // 0.8.0-pre3+ fixes that.
    implementation("com.bloxbean.cardano:cardano-client-lib:0.8.0-pre4")
    implementation("com.bloxbean.cardano:cardano-client-backend-blockfrost:0.8.0-pre4")
    implementation("com.bloxbean.cardano:cardano-client-backend-ogmios:0.8.0-pre4")
    // Aiken blueprint runtime types referenced by the generated model classes
    // (`VerificationKeyHash`, `ScriptHash`, ...). Only the annotation processor
    // depends on these transitively, so they sit on the main compile classpath
    // but not test compile — declare explicitly so both see them.
    implementation("com.bloxbean.cardano:cardano-client-plutus-aiken:0.8.0-pre4")
    // aiken-java-binding ships a JNI wrapper over the Aiken UPLC runtime —
    // we use it for `applyParamsToScript` so the BE can derive each registered
    // config's listing-script address from the unapplied compiled code in
    // plutus.json + the config_nft_policy parameter.
    implementation("com.bloxbean.cardano:aiken-java-binding:0.1.1-preview2")

    // Hydra-derived sha2_256 merkle tree library. Byte-compatible with the
    // on-chain `aiken_merkle_tree/mt` lib (the contracts/ side uses the Aiken
    // port; this is the Java port). easy1staking-com/jpgstore-sniper uses
    // this exact version on the off-chain side; matching it guarantees that
    // BE-computed roots + proofs verify against the v3 wanted_listing
    // validator without any algorithmic drift.
    implementation("org.cardanofoundation:merkle-tree-java:0.0.7")

    // Slot ↔ wall-clock conversions, keyed on a network's Shelley genesis
    // params. Drives SyncStatus's "is the indexer near tip?" check (the
    // adamatic/cardano-recurring-payment-offchain repo uses the same
    // dependency at the same major version for the same purpose).
    implementation("org.cardanofoundation:cf-cardano-conversions-java:1.2.0")

    implementation("com.easy1staking:cardano-client-lib-extensions:0.0.4")

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

// ---------------------------------------------------------------------------
// Operator tools — `api/src/main/java/com/easy1staking/shithole/tools/preprod/`.
// Each Java main() class gets a small Gradle JavaExec task. Source the env
// file (e.g. `set -a; source api/.env.preprod; set +a`) before invoking so
// the tools can read ADMIN_SEED / BLOCKFROST_PROJECT_ID / etc.
// ---------------------------------------------------------------------------
tasks.register<JavaExec>("preprodDeriveAddress") {
    group = "preprod tools"
    description = "Print the preprod payment address derived from ADMIN_SEED."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.preprod.DeriveAddressTool")
    standardInput = System.`in`
}

tasks.register<JavaExec>("preprodCheckBalance") {
    group = "preprod tools"
    description = "Print the preprod UTxO set for the admin wallet via Blockfrost."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.preprod.CheckBalanceTool")
    standardInput = System.`in`
}

tasks.register<JavaExec>("preprodMintCollection") {
    group = "preprod tools"
    description = "Mint a 10-NFT fake-dead-collection under a time-locked native script with CIP-25 metadata."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.preprod.MintCollectionTool")
    standardInput = System.`in`
}

tasks.register<JavaExec>("preprodMintHoskyMimic") {
    group = "preprod tools"
    description = "Mint 10 preprod NFTs with mainnet Hosky asset_names (read from .local/hosky-cashgrab-mainnet.json) so the v3 wanted_listing merkle proofs verify end-to-end on preprod."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.preprod.MintHoskyMimicTool")
    standardInput = System.`in`
}

tasks.register<JavaExec>("preprodMintFungible") {
    group = "preprod tools"
    description = "Mint a preprod fungible token under a one-shot native policy. Args: <asset_name_ascii> <supply_smallest_unit> <decimals> [ticker]."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.preprod.MintPreprodFungibleTool")
    standardInput = System.`in`
}

tasks.register<JavaExec>("preprodListNft") {
    group = "preprod tools"
    description = "List one NFT at the registered listing-script address (use --args=\"ShitterNNN\" to pick)."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.preprod.ListNftTool")
    standardInput = System.`in`
}

tasks.register<JavaExec>("preprodSwap") {
    group = "preprod tools"
    description = "Execute one on-chain Swap: find an (NA,NB) bucket match across wallet + pool, build/sign/submit the swap tx."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.preprod.PreprodSwapTool")
    standardInput = System.`in`
}

tasks.register<JavaExec>("preprodFulfillP2p") {
    group = "preprod tools"
    description = "v3 fulfill diagnostic — picks an active listing from the BE, finds a matching NFT in the wallet, verifies the merkle proof locally, builds the Fulfill tx via QuickTx with Ogmios eval + pre/post-balance dumps. Set FULFILL_DRY_RUN=true to skip submit."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.preprod.PreprodFulfillP2pTool")
    standardInput = System.`in`
}

// ---------------------------------------------------------------------------
// P2P (v3 wanted_listing) tools.
// ---------------------------------------------------------------------------
tasks.register<JavaExec>("p2pBuildPoolMerkle") {
    group = "p2p tools"
    description = "Read .local/rug-pool-matching-traits-merged.csv + .local/hosky-traits/nft_traits.jsonl, compute per-pool merkle roots via merkle-tree-java, write the canonical api/src/main/resources/p2p/pools.json that the BE seeds from at startup."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.easy1staking.shithole.tools.p2p.PoolMerkleBuilder")
    standardInput = System.`in`
}
