#!/bin/bash
# publish.sh — Publish to npm under @icjia scope.
# Usage: ./publish.sh [patch|minor|major]

set -euo pipefail

BUMP="${1:-patch}"

echo "Running tests..."
npm test

echo ""
echo "Bumping version ($BUMP)..."
npm version "$BUMP" --no-git-tag-version

VERSION=$(node -p "require('./package.json').version")
echo "New version: $VERSION"

echo ""
echo "Publishing to npm..."
npm publish --access public

echo ""
echo "Tagging..."
git add -A
git commit -m "v$VERSION"
git tag "v$VERSION"
git push && git push --tags

echo ""
echo "Published @icjia/plausible-mcp v$VERSION"
