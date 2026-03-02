#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Building WASM physics engine ==="
export PATH="$HOME/.cargo/bin:$PATH"
wasm-pack build "$REPO_ROOT/crates/tok-sym-core" \
  --target web \
  --out-dir "$REPO_ROOT/web/src/wasm" \
  --features wasm \
  -- --no-default-features

echo ""
echo "=== Building frontend ==="
cd "$REPO_ROOT/web"
npm run build

echo ""
echo "=== Done! Output in web/dist/ ==="
