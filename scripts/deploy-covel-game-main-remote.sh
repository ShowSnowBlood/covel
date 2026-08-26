#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly REPOSITORY_URL="https://github.com/ShowSnowBlood/covel.git"
readonly WORKSPACE_ROOT="/var/lib/jenkins/workspace"
readonly WORKSPACE="${WORKSPACE_ROOT}/covel-game-main-auto-deploy"
readonly DEPLOY_SCRIPT="/usr/local/sbin/deploy-covel-game-main"

commit="${1:-}"

fail() {
  printf 'deploy-covel-game-main-remote: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" == 0 ]] || fail "must run as root"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "commit must be a 40-character lowercase SHA"
[[ -x "$DEPLOY_SCRIPT" ]] || fail "missing ${DEPLOY_SCRIPT}"

install -d -m 700 "$WORKSPACE_ROOT"
staging="${WORKSPACE_ROOT}/.covel-game-main-${commit}.$$"
cleanup() {
  rm -rf -- "$staging"
}
trap cleanup EXIT

rm -rf -- "$staging"
GIT_TERMINAL_PROMPT=0 git clone --no-checkout --depth 1 "$REPOSITORY_URL" "$staging"
GIT_TERMINAL_PROMPT=0 git -C "$staging" fetch --depth 1 origin "$commit"
git -C "$staging" checkout --detach "$commit"
git -C "$staging" update-ref refs/remotes/origin/main "$commit"

rm -rf -- "$WORKSPACE"
mv -- "$staging" "$WORKSPACE"
trap - EXIT

exec "$DEPLOY_SCRIPT" "$WORKSPACE" "$commit"
