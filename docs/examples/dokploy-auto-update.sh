#!/usr/bin/env bash
# Optional automatic updates of a seotools application on Dokploy (docs/updating.md).
#
# Run it from OUTSIDE the seotools container: a cron job, or a scheduled CI workflow. It redeploys
# the Dokploy application when the image behind a compatibility-line tag (0.2, or 1 from 1.0.0 on)
# changed, and only after the checks below. Dokploy pulls the image reference it has saved when it
# deploys, so the application must be set to that same tag (for example ghcr.io/vhxa/seotools:0.2).
#
# Required environment:
#   DOKPLOY_URL             https://dokploy.example.com
#   DOKPLOY_API_KEY         an API key of Dokploy (it can do much more than this: keep it private)
#   DOKPLOY_APPLICATION_ID  the application to redeploy
#   SEOTOOLS_URL            the public URL of the seotools instance
#   SEOTOOLS_TAG            the line to follow: 0.2, 1.4 or 1 (never latest, edge, sha-… or a candidate)
# Optional:
#   PRE_UPDATE_COMMAND      a command that takes a backup and fails if it could not
#   SEOTOOLS_IMAGE_REPOSITORY  default vhxa/seotools (a public package on ghcr.io)
#   STATE_DIR               where it remembers what it deployed (default ~/.local/state/seotools-auto-update)
#   WAIT_SECONDS            how long to wait for the new version to be healthy (default 600)
#
# It stops with a non-zero exit code, so that cron or the workflow tells you, when a check fails.
# It does not read release notes, and it does not roll back: see "When something goes wrong".
set -euo pipefail

: "${DOKPLOY_URL:?}" "${DOKPLOY_API_KEY:?}" "${DOKPLOY_APPLICATION_ID:?}" "${SEOTOOLS_URL:?}" "${SEOTOOLS_TAG:?}"
repository="${SEOTOOLS_IMAGE_REPOSITORY:-vhxa/seotools}"
state_dir="${STATE_DIR:-${HOME}/.local/state/seotools-auto-update}"
wait_seconds="${WAIT_SECONDS:-600}"
tag="$SEOTOOLS_TAG"

say() { printf '%s\n' "$*"; }
die() { printf 'seotools-auto-update: %s\n' "$*" >&2; exit 1; }

# 1. Only a line that promises compatibility: 0.2 / 1.4 (patches) or 1 / 2 (from 1.0.0). Never 0.
[[ "$tag" =~ ^[0-9]+\.[0-9]+$ || "$tag" =~ ^[1-9][0-9]*$ ]] ||
  die "SEOTOOLS_TAG=$tag is not a compatibility line (X.Y, or X from 1.0.0). Never latest, edge, sha-… or a candidate."

registry_digest() {
  local token
  token="$(curl -fsS -m 20 "https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull" | jq -r .token)"
  curl -fsSI -m 20 -H "Authorization: Bearer ${token}" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/${repository}/manifests/${tag}" |
    tr -d '\r' | awk -F': ' 'tolower($1) == "docker-content-digest" { print $2 }'
}

health() { curl -fsS -m 10 "${SEOTOOLS_URL%/}/api/health?require=worker"; }

mkdir -p "$state_dir"
deployed_file="${state_dir}/${tag}.deployed"
failed_file="${state_dir}/${tag}.failed"

remote="$(registry_digest)"
[[ "$remote" =~ ^sha256:[0-9a-f]{64}$ ]] || die "could not read the digest of ${repository}:${tag}"

# 2. The image behind the tag changed since the last deployment this script made.
if [[ ! -f "$deployed_file" ]]; then
  printf '%s\n' "$remote" > "$deployed_file"
  say "First run: ${repository}:${tag} is ${remote}. Taken as what is deployed now; nothing to do."
  exit 0
fi
[[ "$(cat "$deployed_file")" != "$remote" ]] || { say "${repository}:${tag} has not changed. Nothing to do."; exit 0; }
if [[ -f "$failed_file" && "$(cat "$failed_file")" == "$remote" ]]; then
  die "an update to ${remote} already failed. Look into it, then delete ${failed_file} to try again."
fi

# 3. What runs now is healthy and is a release: do not update something broken, or a development build.
before="$(health)" || die "the instance does not answer ${SEOTOOLS_URL}/api/health"
[[ "$(jq -r .status <<< "$before")" == "ok" ]] || die "the instance is not healthy: $before"
[[ "$(jq -r .channel <<< "$before")" == "release" ]] || die "the instance is not a release build: $before"
version_before="$(jq -r .version <<< "$before")"

# 4. Your own pre-update step (a backup that fails if it could not be made).
if [[ -n "${PRE_UPDATE_COMMAND:-}" ]]; then
  say "Running PRE_UPDATE_COMMAND…"
  bash -c "$PRE_UPDATE_COMMAND" || die "PRE_UPDATE_COMMAND failed; not updating"
fi

say "Updating ${version_before}: ${repository}:${tag} is now ${remote}."
curl -fsS -m 60 -X POST "${DOKPLOY_URL%/}/api/application.deploy" \
  -H "x-api-key: ${DOKPLOY_API_KEY}" -H 'content-type: application/json' \
  -d "$(jq -n --arg id "$DOKPLOY_APPLICATION_ID" --arg digest "$remote" \
    '{applicationId: $id, title: "seotools automatic update", description: $digest}')" > /dev/null ||
  die "Dokploy refused the deployment"

# Wait for a different version that is healthy.
deadline=$((SECONDS + wait_seconds))
while ((SECONDS < deadline)); do
  sleep "${POLL_SECONDS:-10}"
  if after="$(health 2> /dev/null)" &&
    [[ "$(jq -r .status <<< "$after")" == "ok" && "$(jq -r .version <<< "$after")" != "$version_before" ]]; then
    printf '%s\n' "$remote" > "$deployed_file"
    rm -f "$failed_file"
    say "Updated: $(jq -r .version <<< "$before") → $(jq -r .version <<< "$after"), healthy."
    exit 0
  fi
done

printf '%s\n' "$remote" > "$failed_file"
die "after ${wait_seconds}s the instance is not healthy on a new version. Check Dokploy's logs and, if the new version migrated the database, restore the backup (docs/updating.md)."
