#!/bin/bash
# publish.sh — Publish to npm under @icjia scope.
# Usage: ./publish.sh [patch|minor|major]

set -euo pipefail

BUMP="${1:-patch}"

# ─── Pre-flight checks ─────────────────────────────────────────────

# Verify npm auth
echo "Checking npm auth..."
if ! npm whoami > /dev/null 2>&1; then
  echo "Error: Not logged into npm. Run 'npm login' first."
  exit 1
fi

# Verify clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is dirty. Commit or stash changes first."
  git status --short
  exit 1
fi

# Verify we're on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Warning: Publishing from branch '$BRANCH' (not main). Continue? [y/N]"
  read -r REPLY
  if [ "$REPLY" != "y" ] && [ "$REPLY" != "Y" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# ─── Test ───────────────────────────────────────────────────────────

echo ""
echo "Running tests..."
npm test

# ─── Bump version ───────────────────────────────────────────────────

echo ""
echo "Bumping version ($BUMP)..."
npm version "$BUMP" --no-git-tag-version

VERSION=$(node -p "require('./package.json').version")
echo "New version: $VERSION"

# Check tag doesn't already exist
if git tag -l "v$VERSION" | grep -q .; then
  echo "Error: Tag v$VERSION already exists."
  exit 1
fi

# ─── Publish ────────────────────────────────────────────────────────

echo ""
echo "Publishing to npm..."
npm publish --access public

# ─── Git commit + tag ───────────────────────────────────────────────

echo ""
echo "Committing and tagging..."
git add package.json package-lock.json
git commit -m "v$VERSION"
git tag "v$VERSION"
git push && git push --tags

echo ""
echo "Published @icjia/plausible-mcp v$VERSION"
