# Git Snapshot Extension

Slash command for creating, listing, and restoring git workspace snapshots without exposing snapshot functionality as an LLM tool.

## Command Surface

- `/snapshot create [--message "..."] [--tracked-only]`
- `/snapshot list [--limit N]`
- `/snapshot restore [<snapshot>] [--no-index] [--yes]`

## Frozen Behavior

### create

- Creates a stash-style snapshot of the current workspace.
- Includes untracked files by default.
- `--tracked-only` excludes untracked files.
- Must preserve the current worktree and index state.
- Requires an existing `HEAD` commit for v1.
- Does not include ignored files in v1.

### list

- Lists only snapshots created by this extension.
- Does not show unrelated user stash entries.
- Will filter by the message prefix `pi snapshot:`.
- Supports `--limit N` for truncation.

### restore

- Restores a previously created snapshot.
- Uses `git stash apply --index` by default.
- `--no-index` restores without index state.
- If the target workspace is dirty, confirmation is required unless `--yes` is passed.
- Does not drop the stash entry after restore.

## UX Rules

- `/snapshot` with no arguments shows help.
- `/snapshot help` shows help.
- Invalid subcommands or malformed arguments show help plus an error message.
- Interactive mode should prefer pickers and confirmations.
- Non-interactive mode should fail conservatively for restore operations.
- v1 intentionally does not persist snapshot metadata into pi session entries (`appendEntry` is not used).
