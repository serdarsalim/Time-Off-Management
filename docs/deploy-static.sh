#!/usr/bin/env bash

set -euo pipefail

docs_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export_dir="$(mktemp -d)"

cleanup() {
  if [[ -n "${export_dir:-}" && -d "$export_dir" ]]; then
    rm -rf -- "$export_dir"
  fi
}
trap cleanup EXIT

cd "$docs_dir"

npx --yes mintlify@latest export --output "$export_dir/time-off-help.zip"
unzip -q "$export_dir/time-off-help.zip" -d "$export_dir/site"

# Mintlify's local exporter prefixes configured canonicals with /src/_props.
# Remove that build-only segment before publishing the static help center.
rg -l 'https://time-off-help\.autotakt\.dev/src/_props' "$export_dir/site" \
  | xargs perl -pi -e \
    's|https://time-off-help\.autotakt\.dev/src/_props|https://time-off-help.autotakt.dev|g'

if rg -q 'time-off-help\.autotakt\.dev/src/_props' "$export_dir/site"; then
  echo "Static export still contains build-only canonical URLs." >&2
  exit 1
fi

cp robots.txt sitemap.xml "$export_dir/site/"

npx vercel link --yes --project time-off-help --cwd "$export_dir/site"
npx vercel deploy --prod --yes --cwd "$export_dir/site"
