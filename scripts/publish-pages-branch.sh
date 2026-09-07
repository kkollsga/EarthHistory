#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "publish-pages: this directory is not a Git worktree" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "publish-pages: source worktree must be clean" >&2
  exit 1
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "publish-pages: origin remote is missing" >&2
  exit 1
fi

SOURCE_COMMIT=$(git rev-parse HEAD)
make gate-full
git fetch origin gh-pages
PAGES_COMMIT=$(git rev-parse refs/remotes/origin/gh-pages)
PAGES_WORKTREE=$(mktemp -d "${TMPDIR:-/tmp}/earthhistory-pages.XXXXXX")

cleanup() {
  git worktree remove --force "$PAGES_WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$PAGES_WORKTREE"
}
trap cleanup EXIT HUP INT TERM

git worktree add --detach "$PAGES_WORKTREE" "$PAGES_COMMIT"
rsync -a --delete --exclude=.git --exclude=.nojekyll dist/ "$PAGES_WORKTREE/"
: > "$PAGES_WORKTREE/.nojekyll"
git -C "$PAGES_WORKTREE" add -A

if git -C "$PAGES_WORKTREE" diff --cached --quiet; then
  echo "publish-pages: gh-pages already matches validated dist"
  exit 0
fi

git -C "$PAGES_WORKTREE" commit -m "chore: publish $SOURCE_COMMIT"
git -C "$PAGES_WORKTREE" push origin HEAD:gh-pages
echo "publish-pages: published $SOURCE_COMMIT to gh-pages"
