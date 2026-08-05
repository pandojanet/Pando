#!/usr/bin/env bash
# Stop hook: keeps CLAUDE.md from going stale.
#
# Fires only when this turn changed a meaningful amount of app or docs code and
# left CLAUDE.md untouched. In that case it blocks the turn once (exit 2, reason
# on stderr) so the status table / decisions log get updated in the same turn as
# the change — which is the whole point of the file.
#
# Silent no-op when: git isn't initialised, nothing changed, only a file or two
# changed (typos, copy tweaks), CLAUDE.md is already among the changes, or the
# hook already fired this turn.
#
# To disable: delete the "Stop" block from .claude/settings.json.

set -u

payload=$(cat 2>/dev/null || true)
# Documented loop guard: never block a stop that a stop hook already caused.
case "$payload" in
  *'"stop_hook_active":true'*) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

changed=$(git status --porcelain 2>/dev/null | sed 's/^...//' | sed 's/.* -> //')
[ -z "$changed" ] && exit 0

# CLAUDE.md already updated — nothing to nag about.
printf '%s\n' "$changed" | grep -qx 'CLAUDE.md' && exit 0

code_changes=$(printf '%s\n' "$changed" \
  | grep -E '^(web/(app|lib|components)/|docs/)' \
  | grep -vE '\.(test|spec)\.' \
  | wc -l | tr -d ' ')

# One or two files is a tweak; three or more is usually functionality.
[ "${code_changes:-0}" -lt 3 ] && exit 0

cat >&2 <<EOF
CLAUDE.md was not updated, but $code_changes files under web/ or docs/ changed this turn.
Before finishing: update the status table, and add a Decisions row if a choice was made
that a future session could unknowingly undo (see CLAUDE.md → "Keeping this file current").
If this turn genuinely needs no context change, touch CLAUDE.md's date line or say so explicitly.
EOF
exit 2
