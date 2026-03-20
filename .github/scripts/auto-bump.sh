#!/usr/bin/env bash
#
# Auto-bump package versions based on commit messages since last publish.
# Determines bump type from conventional commits:
#   - BREAKING CHANGE / feat!: → major
#   - feat: → minor
#   - fix: / chore: / everything else → patch
#
# Usage: ./auto-bump.sh [package_dir...]
#   If no dirs specified, bumps all main packages.
#
# This script is idempotent — if the local version already exceeds npm,
# no bump is performed.

set -euo pipefail

bump_package() {
  local dir="$1"
  local name
  name=$(node -p "require('./$dir/package.json').name")
  local local_version
  local_version=$(node -p "require('./$dir/package.json').version")
  local npm_version
  npm_version=$(npm view "$name" version 2>/dev/null || echo "0.0.0")

  # Already bumped (local > npm) — skip
  if [ "$local_version" != "$npm_version" ]; then
    echo "✓ $name: $local_version (already ahead of npm $npm_version)"
    return
  fi

  # Determine bump type from commits that touched this package since last tag
  local bump="patch"
  local commits
  commits=$(git log --oneline --no-merges HEAD ^origin/main~10 -- "$dir" 2>/dev/null || git log --oneline -20 -- "$dir")

  if echo "$commits" | grep -qiE 'BREAKING[ _]CHANGE|!:'; then
    bump="major"
  elif echo "$commits" | grep -qiE '^[a-f0-9]+ feat'; then
    bump="minor"
  fi

  # Bump version
  cd "$dir"
  npm version "$bump" --no-git-tag-version --allow-same-version
  local new_version
  new_version=$(node -p "require('./package.json').version")
  cd - > /dev/null

  echo "⬆ $name: $npm_version → $new_version ($bump)"
}

# Default packages if none specified
if [ $# -eq 0 ]; then
  set -- packages/core packages/ai packages/cli packages/vscode-extension packages/opentuicli
fi

for pkg in "$@"; do
  if [ -f "$pkg/package.json" ]; then
    bump_package "$pkg"
  else
    echo "⚠ Skipping $pkg (no package.json)"
  fi
done
