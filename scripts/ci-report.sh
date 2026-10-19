#!/usr/bin/env bash
# Report a failed run once. If an open issue with this title exists, comment on
# it instead of opening a second one — an hourly job that fails for a day would
# otherwise leave 24 issues.
#
#   scripts/ci-report.sh "上游同步失败" "正文（markdown）"
#
# Needs GH_TOKEN in the environment (the workflow passes the built-in token).
set -euo pipefail

title="${1:-上游同步失败}"
body="${2:-}"
repo="${GITHUB_REPOSITORY:-}"

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::warning::GH_TOKEN not set, cannot report"
  exit 0
fi
if [ -z "$repo" ]; then
  echo "::warning::GITHUB_REPOSITORY not set, cannot report"
  exit 0
fi

existing="$(gh issue list --repo "$repo" --label i18n --state open \
  --search "${title} in:title" --json number --jq '.[0].number // empty' 2>/dev/null || true)"

if [ -n "$existing" ]; then
  gh issue comment "$existing" --repo "$repo" --body "$body"
  echo "已在 issue #${existing} 追加评论"
else
  gh issue create --repo "$repo" --title "$title" --label i18n --body "$body"
fi
