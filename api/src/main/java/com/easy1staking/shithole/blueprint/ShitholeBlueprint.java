package com.easy1staking.shithole.blueprint;

import com.bloxbean.cardano.client.plutus.aiken.annotation.AikenStdlib;
import com.bloxbean.cardano.client.plutus.aiken.annotation.AikenStdlibVersion;
import com.bloxbean.cardano.client.plutus.annotation.Blueprint;

/**
 * CCL blueprint marker. The annotation processor reads {@code contracts/plutus.json}
 * (the Aiken-emitted CIP-57 blueprint) at compile time and generates Java types for
 * {@code ConfigDatum}, {@code ListingDatum}, {@code ListingRedeemer}, etc. under
 * {@code build/generated/sources/annotationProcessor/java/main/com/easy1staking/shithole/blueprint/generated/}.
 *
 * <p>The file path is resolved relative to the Gradle module's project directory;
 * Gradle compileJava runs with the {@code api/} module as CWD so {@code ../contracts}
 * points at the repo-root {@code contracts/} dir.
 *
 * <p>Per SPEC §10.2: no hand-maintained Java mirrors of on-chain datum/redeemer types —
 * the Aiken blueprint is the single source of truth.
 */
@Blueprint(
        file = "../contracts/plutus.json",
        packageName = "com.easy1staking.shithole.blueprint.generated"
)
@AikenStdlib(AikenStdlibVersion.V1)
public interface ShitholeBlueprint {
}
