#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' \
    'Create a stash snapshot without changing the working tree or index.' \
    '' \
    'Usage:' \
    '  create-stash-snapshot.sh [--json] [--message <text>] [--tracked-only]' \
    '' \
    'Options:' \
    '  -m, --message <text>  Custom stash message' \
    '      --tracked-only   Snapshot tracked changes only' \
    '      --json           Emit JSON output' \
    '      --help           Show this help'
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

json_escape() {
  local value=${1-}
  value=${value//\\/\\\\}
  value=${value//"/\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '%s' "$value"
}

emit_json_result() {
  local created=$1
  local reason=$2
  local repo_root=$3
  local snapshot_commit=$4
  local stash_ref=$5
  local message=$6
  local included_untracked=$7
  local included_ignored=$8

  printf '{"created":%s,"reason":%s,"repoRoot":"%s","snapshotCommit":%s,"stashRef":%s,"message":%s,"includedUntracked":%s,"includedIgnored":%s}\n' \
    "$created" \
    "$reason" \
    "$(json_escape "$repo_root")" \
    "$snapshot_commit" \
    "$stash_ref" \
    "$message" \
    "$included_untracked" \
    "$included_ignored"
}

json_mode=0
message=''
include_untracked=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      [[ $# -ge 2 ]] || die 'missing value for --message'
      message="$2"
      shift 2
      ;;
    --tracked-only)
      include_untracked=0
      shift
      ;;
    --json)
      json_mode=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ $# -eq 0 ]] || die 'unexpected positional arguments'

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die 'not inside a Git working tree'

head_commit=$(git rev-parse --verify HEAD 2>/dev/null) || die 'this repository does not have a HEAD commit yet; create an initial commit first'
repo_root=$(git rev-parse --show-toplevel)
repo_name=$(basename "$repo_root")
branch_label=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || printf '(detached HEAD)')
short_head=$(git rev-parse --short "$head_commit")
head_subject=$(git log -1 --format=%s "$head_commit")

if [[ -z "$message" ]]; then
  timestamp=$(date '+%Y-%m-%d %H:%M:%S %z')
  message="pi snapshot: ${repo_name} ${timestamp}"
fi

untracked_list=''
scratch_index=''
original_git_index_file=${GIT_INDEX_FILE-}
cleanup() {
  if [[ -n "$original_git_index_file" ]]; then
    export GIT_INDEX_FILE="$original_git_index_file"
  else
    unset GIT_INDEX_FILE 2>/dev/null || true
  fi

  if [[ -n "$untracked_list" ]]; then
    rm -f "$untracked_list"
  fi

  if [[ -n "$scratch_index" ]]; then
    rm -f "$scratch_index"
  fi
}
trap cleanup EXIT

has_untracked=0
if [[ "$include_untracked" -eq 1 ]]; then
  untracked_list=$(mktemp "${TMPDIR:-/tmp}/git-workspace-snapshot-untracked.XXXXXX")
  git ls-files --others --exclude-standard -z > "$untracked_list"
  if [[ -s "$untracked_list" ]]; then
    has_untracked=1
  fi
fi

tracked_commit=''
if ! tracked_commit=$(git stash create "$message"); then
  die 'git stash create failed'
fi

if [[ -n "$tracked_commit" ]]; then
  index_commit=$(git rev-parse "$tracked_commit^2")
  worktree_tree=$(git rev-parse "$tracked_commit^{tree}")
else
  index_tree=$(git write-tree)
  index_commit=$(printf 'index on %s: %s %s\n' "$branch_label" "$short_head" "$head_subject" | git commit-tree "$index_tree" -p "$head_commit")
  worktree_tree=$(git rev-parse "$head_commit^{tree}")
fi

if [[ -z "$tracked_commit" && "$has_untracked" -eq 0 ]]; then
  if [[ "$json_mode" -eq 1 ]]; then
    emit_json_result false '"no tracked or untracked changes found"' "$repo_root" null null null false false
  else
    printf '%s\n' \
      'No stash snapshot created.' \
      'stash_created=no' \
      'reason=no tracked or untracked changes found'
  fi
  exit 0
fi

untracked_commit=''
if [[ "$has_untracked" -eq 1 ]]; then
  scratch_index=$(mktemp "${TMPDIR:-/tmp}/git-workspace-snapshot-index.XXXXXX")
  export GIT_INDEX_FILE="$scratch_index"
  git read-tree --empty
  git update-index --add -z --stdin < "$untracked_list"
  untracked_tree=$(git write-tree)
  untracked_commit=$(printf 'untracked files on %s: %s %s\n' "$branch_label" "$short_head" "$head_subject" | git commit-tree "$untracked_tree")

  if [[ -n "$original_git_index_file" ]]; then
    export GIT_INDEX_FILE="$original_git_index_file"
  else
    unset GIT_INDEX_FILE
  fi
fi

if [[ -n "$tracked_commit" && -z "$untracked_commit" ]]; then
  final_commit="$tracked_commit"
else
  commit_tree_args=(-p "$head_commit" -p "$index_commit")
  if [[ -n "$untracked_commit" ]]; then
    commit_tree_args+=(-p "$untracked_commit")
  fi
  final_commit=$(printf 'On %s: %s\n' "$branch_label" "$message" | git commit-tree "$worktree_tree" "${commit_tree_args[@]}")
fi

git stash store -m "$message" "$final_commit"
stash_commit=$(git rev-parse stash@{0})
[[ "$stash_commit" == "$final_commit" ]] || die 'created stash commit does not match the stored stash reference'

if [[ "$json_mode" -eq 1 ]]; then
  if [[ "$has_untracked" -eq 1 ]]; then
    json_included_untracked=true
  else
    json_included_untracked=false
  fi
  emit_json_result true null "$repo_root" "\"$(json_escape "$stash_commit")\"" '"stash@{0}"' "\"$(json_escape "$message")\"" "$json_included_untracked" false
else
  printf '%s\n' \
    'Created stash snapshot without changing the working tree or index.' \
    'stash_created=yes' \
    "stash_ref=stash@{0}" \
    "stash_commit=$stash_commit" \
    "message=$message" \
    "included_untracked=$([[ "$has_untracked" -eq 1 ]] && printf 'yes' || printf 'no')" \
    'included_ignored=no'
fi
