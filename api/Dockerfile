# syntax=docker/dockerfile:1.7
#
# Shithole BE image.
#
# Build context MUST be the repo root (NOT api/) because the CCL annotation
# processor needs `../contracts/plutus.json` at compile time
# (api/src/.../blueprint/ShitholeBlueprint.java's @Blueprint annotation
# resolves the file path relative to the api/ module). Build with:
#
#   docker build -f api/Dockerfile -t ghcr.io/easy1staking/shithole-api:<tag> .
#
# Image is multi-arch capable (--platform linux/amd64,linux/arm64); the
# aiken-java-binding native bits bundled inside the JAR pick the right
# .so at runtime.

# ---------------------------------------------------------------------------
# Stage 1: Gradle build
# ---------------------------------------------------------------------------
FROM eclipse-temurin:21-jdk AS build

WORKDIR /workspace

# Copy ONLY the gradle wrapper + build descriptors first so the dep
# resolution layer caches independently of source changes.
COPY api/gradlew api/gradle.properties* api/settings.gradle.kts api/build.gradle.kts ./api/
COPY api/gradle ./api/gradle

# Pre-warm the gradle dep cache. `--no-daemon` because the container's
# one-shot; `dependencies` walks the graph without compiling.
RUN cd api && ./gradlew --no-daemon dependencies > /dev/null 2>&1 || true

# Now copy what the build actually compiles:
#   - api source
#   - contracts/plutus.json (the CCL annotation processor reads this at
#     compile time; the path `../contracts/plutus.json` is resolved
#     relative to the api/ module's CWD).
COPY api/src ./api/src
COPY contracts/plutus.json ./contracts/plutus.json

# Build the Spring Boot fat JAR. Output: api/build/libs/api-<version>.jar.
RUN cd api && ./gradlew --no-daemon bootJar -x test

# Find the jar (filename varies with version) and stage it at a known path.
RUN cp api/build/libs/$(ls api/build/libs/ | grep -E '\.jar$' | grep -v plain | head -n1) /workspace/app.jar

# ---------------------------------------------------------------------------
# Stage 2: minimal JRE runtime
# ---------------------------------------------------------------------------
FROM eclipse-temurin:21-jre

# Non-root user. Spring Boot doesn't need anything privileged.
RUN groupadd --system --gid 1001 shithole \
 && useradd  --system --uid 1001 --gid shithole --home /app --shell /sbin/nologin shithole

WORKDIR /app
COPY --from=build /workspace/app.jar /app/app.jar
RUN chown -R shithole:shithole /app

USER shithole

EXPOSE 8080

# JVM tuning:
#   - MaxRAMPercentage 75% — Spring Boot + Yaci-Store sit at ~600MB working
#     set; on a 1Gi container that's safe headroom under k8s memory limits.
#   - PreferContainerQuotaForCPUCount + ActiveProcessorCount detection are
#     defaults in JDK 21+; no override needed.
#   - EnableDynamicAgentLoading=false silences a warning from CCL's
#     reflection helpers; the runtime doesn't actually attach agents.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -Djdk.attach.allowAttachSelf=false"

# Health probes live in the chart's deployment spec — see
# applications/shithole/templates/deployment.yaml. Spring Boot Actuator
# exposes /actuator/health/{liveness,readiness} when management endpoints
# are enabled in application.yaml.

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
