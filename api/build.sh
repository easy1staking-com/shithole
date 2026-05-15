#!/usr/bin/env bash
#
# Local build + push of the shithole-api image. Use when GH Actions is
# unavailable (private repo first push, runner quota exhausted, etc).
#
# Prerequisites:
#   - docker buildx available (default on recent Docker Desktop)
#   - logged in to GHCR:
#       echo $GHCR_PAT | docker login ghcr.io -u <gh-user> --password-stdin
#
# The build context is the REPO ROOT (NOT api/) because the CCL annotation
# processor needs ../contracts/plutus.json at compile time. The script cd's
# there automatically so it works whether you call it from api/ or the
# repo root.

set -xeuo pipefail

# Run from the repo root regardless of where the user invoked us.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Version: nearest tag + commits-since + sha, or just the sha if no tags
# exist yet. --dirty suffix when the working tree has uncommitted changes.
VERSION="$(git describe --tags --always --dirty 2>/dev/null || git rev-parse --short HEAD)"
echo "Building version: ${VERSION}"

DOCKER_REGISTRY="${DOCKER_REGISTRY:-ghcr.io}"
DOCKER_IMAGE_NAME="${DOCKER_IMAGE_NAME:-easy1staking-com/shithole-api}"
DOCKER_IMAGE="${DOCKER_REGISTRY}/${DOCKER_IMAGE_NAME}:${VERSION}"
DOCKER_IMAGE_LATEST="${DOCKER_REGISTRY}/${DOCKER_IMAGE_NAME}:latest"

# Default: build + push. Pass --no-push to keep the image local for a
# quick smoke (e.g. `./api/build.sh --no-push && docker run ...`).
PUSH_FLAG="--push"
if [[ "${1:-}" == "--no-push" ]]; then
  PUSH_FLAG="--load"
fi

docker buildx build \
  -f api/Dockerfile \
  -t "${DOCKER_IMAGE}" \
  -t "${DOCKER_IMAGE_LATEST}" \
  --platform linux/amd64 \
  ${PUSH_FLAG} \
  .
