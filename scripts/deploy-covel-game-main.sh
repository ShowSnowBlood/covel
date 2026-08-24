#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly APP_ROOT="/opt/covel-game"
readonly RELEASES_DIR="${APP_ROOT}/releases"
readonly CURRENT_LINK="${APP_ROOT}/current"
readonly ENV_FILE="${APP_ROOT}/secrets/app.env"
readonly LLM_CONFIG="${APP_ROOT}/config/llm.toml"
readonly BACKUP_DIR="${APP_ROOT}/backups"
readonly LOCK_FILE="/run/lock/covel-game-deploy.lock"
readonly COMPOSE_PROJECT="docker"
readonly HEALTH_URL="http://127.0.0.1:3301/api/health"
readonly ACCOUNT_URL="http://127.0.0.1:3301/api/frostfox/account"

workspace="${1:-}"
commit="${2:-}"

fail() {
  printf 'deploy-covel-game-main: %s\n' "$*" >&2
  exit 1
}

[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "commit must be a 40-character lowercase SHA"
[[ -n "$workspace" ]] || fail "workspace is required"
workspace="$(readlink -f -- "$workspace")"
case "$workspace" in
  /var/lib/jenkins/workspace/*) ;;
  *) fail "workspace must be inside /var/lib/jenkins/workspace" ;;
esac

[[ -d "${workspace}/.git" ]] || fail "workspace is not a Git checkout"
[[ "$(git -C "$workspace" rev-parse HEAD)" == "$commit" ]] || fail "workspace HEAD does not match requested commit"
[[ "$(git -C "$workspace" rev-parse origin/main)" == "$commit" ]] || fail "requested commit is not the checked-out origin/main"
[[ -f "$ENV_FILE" ]] || fail "missing production environment file"
[[ -f "$LLM_CONFIG" ]] || fail "missing persistent llm.toml"

exec 9>"$LOCK_FILE"
flock -n 9 || fail "another production deployment is running"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${POSTGRES_USER:?POSTGRES_USER is required in app.env}"
: "${POSTGRES_DB:?POSTGRES_DB is required in app.env}"

readonly release_id="${commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
readonly release_dir="${RELEASES_DIR}/${release_id}"
readonly image="covel-game:${commit}"
previous_release="$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)"
previous_image="docker-app:latest"
if [[ -n "$previous_release" && -f "${previous_release}/.deploy-image" ]]; then
  previous_image="$(<"${previous_release}/.deploy-image")"
fi
activated=0

compose_up() {
  local release="$1"
  local deploy_image="$2"
  COVEL_APP_IMAGE="$deploy_image" docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --env-file "$ENV_FILE" \
    --file "${release}/docker/docker-compose.yml" \
    up --detach --no-build --remove-orphans
}

wait_for_endpoint() {
  local url="$1"
  local expected="$2"
  local attempt
  for attempt in $(seq 1 60); do
    if curl --fail --silent --show-error "$url" 2>/dev/null | grep -Fq "$expected"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  local status=$?
  trap - ERR
  if [[ "$activated" == 1 && -n "$previous_release" && -d "$previous_release" ]]; then
    printf 'Deployment failed; restoring %s with %s\n' "$previous_release" "$previous_image" >&2
    ln -sfn "$previous_release" "${CURRENT_LINK}.rollback"
    mv -Tf "${CURRENT_LINK}.rollback" "$CURRENT_LINK"
    compose_up "$previous_release" "$previous_image" || true
    wait_for_endpoint "$HEALTH_URL" '"status":"ok"' || true
  fi
  exit "$status"
}
trap rollback ERR

mkdir -p "$RELEASES_DIR" "$BACKUP_DIR" "$release_dir"
rsync --archive --delete \
  --exclude='.env' \
  --exclude='.env.llm' \
  --exclude='.git/' \
  --exclude='.turbo/' \
  --exclude='node_modules/' \
  --exclude='**/node_modules/' \
  --exclude='debugs/' \
  --exclude='test-results/' \
  "${workspace}/" "${release_dir}/"
ln -s "$ENV_FILE" "${release_dir}/.env"
ln -s "$LLM_CONFIG" "${release_dir}/llm.toml"
printf '%s\n' "$image" >"${release_dir}/.deploy-image"
printf '%s\n' "$commit" >"${release_dir}/.deploy-commit"

docker build \
  --pull \
  --label "org.opencontainers.image.revision=${commit}" \
  --tag "$image" \
  --file "${release_dir}/docker/Dockerfile" \
  "$release_dir"

docker exec covel-postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format custom \
  >"${BACKUP_DIR}/pre-${release_id}.dump"

ln -sfn "$release_dir" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "$CURRENT_LINK"
activated=1
compose_up "$release_dir" "$image"
wait_for_endpoint "$HEALTH_URL" '"status":"ok"'
wait_for_endpoint "$ACCOUNT_URL" '"clientId":"covel-game"'

activated=0
trap - ERR
printf 'Deployed %s as %s\n' "$commit" "$image"
