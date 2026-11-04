#!/usr/bin/env bash
# The Pages deployments of this repository that may still be in progress.
#
# Every push to main makes one Pages deployment, named by the commit sha, and
# GitHub refuses a new one while a previous one is still in progress:
#   Deployment request failed for <sha> due to in progress deployment.
#   Please cancel <other sha> first or wait for it to complete.
# A deployment finishes its file sync in seconds but the backend can hold it
# for 20 minutes and more afterwards (purging_cdn), so two pushes a few
# minutes apart made the second one wait up to half an hour. Only the newest
# build matters, so an in-progress deployment is cancelled rather than waited
# for. There is no endpoint listing Pages deployments: the candidates are
# the heads of this workflow's recent runs (actions: read).
#
#   pages-deployments.sh cancel   cancel every candidate still in progress
#   pages-deployments.sh wait     cancel, then poll until none is in progress
#                                 (TIMEOUT seconds, 900 by default)
set -euo pipefail

mode=${1:?usage: pages-deployments.sh cancel|wait}
repo=$GITHUB_REPOSITORY
me=$GITHUB_SHA
workflow=$(basename "${GITHUB_WORKFLOW_REF%@*}")

candidates() {
  gh run list --repo "$repo" --workflow "$workflow" --limit 15 --json headSha --jq '.[].headSha' \
    | grep -v "^$me$" | sort -u
}

status_of() {
  # "" for a deployment the backend no longer reports on, "unknown" for a
  # 404 (never deployed, or expired).
  gh api "repos/$repo/pages/deployments/$1" --jq '.status' 2>/dev/null || echo "unknown"
}

in_progress() {
  case "$1" in
    deployment_in_progress|syncing_files|finished_file_sync|updating_pages|purging_cdn) return 0 ;;
    *) return 1 ;;
  esac
}

# Cancels what is in progress (log on stderr); prints the shas it could not
# cancel on stdout.
cancel_in_progress() {
  local sha status left=""
  for sha in $(candidates); do
    status=$(status_of "$sha")
    if in_progress "$status"; then
      if gh api -X POST "repos/$repo/pages/deployments/$sha/cancel" >/dev/null 2>&1; then
        echo "cancelled the deployment of ${sha:0:7} ($status)" >&2
      else
        echo "::warning title=Pages deployment::could not cancel the deployment of ${sha:0:7} ($status)" >&2
        left="$left $sha"
      fi
    else
      echo "${sha:0:7}: ${status:-done}" >&2
    fi
  done
  echo "$left"
}

case "$mode" in
  cancel)
    cancel_in_progress >/dev/null
    ;;
  wait)
    timeout=${TIMEOUT:-900}
    start=$(date +%s)
    while :; do
      left=$(cancel_in_progress)
      busy=""
      for sha in $left; do
        in_progress "$(status_of "$sha")" && busy="$busy ${sha:0:7}"
      done
      elapsed=$(( $(date +%s) - start ))
      if [ -z "$busy" ]; then
        echo "no previous deployment in progress after ${elapsed}s"
        break
      fi
      if [ "$elapsed" -ge "$timeout" ]; then
        echo "::warning title=Pages deployment::still in progress after ${elapsed}s:$busy"
        break
      fi
      echo "in progress:$busy, ${elapsed}s elapsed"
      sleep 30
    done
    ;;
  *)
    echo "usage: pages-deployments.sh cancel|wait" >&2
    exit 2
    ;;
esac
