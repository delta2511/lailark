#!/usr/bin/env bash
# Prepares a cloud Claude Code session to run this repo's checks.
#
#   bash scripts/cloud-setup.sh
#
# The cloud container is ephemeral: nothing here survives the session, so it runs
# again every time. It is idempotent, so running it twice is cheap and safe.
#
# Five steps, each one a gap found by the 25 Sep 2026 cloud readiness report
# (docs/cloud-sessions.md records the findings):
#
#   1. npm ci
#   2. firebase-tools, pinned in .firebase-tools-version, the same pin CI uses.
#      Six workspace scripts call a bare `firebase` and it is not a dependency.
#   3. Prefetch the three emulator JARs (199 MB). They download fine.
#   4. Shim the Chromium revision @playwright/test wants onto the browser the image
#      already ships. `playwright install` cannot work: cdn.playwright.dev is blocked.
#   5. certutil plus the Anthropic CAs in the NSS store, or the site's
#      zero-console-errors assertion fails on ERR_CERT_AUTHORITY_INVALID.
#
# Not for a Mac. On a Mac, `npm install` and `npx playwright install chromium` are
# the whole story.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "This is a Mac. scripts/cloud-setup.sh is for the cloud container only."
  echo "Use: npm install && npx playwright install chromium"
  exit 1
fi

step() { printf '\n== %s\n' "$1"; }

step "1/5 npm ci"
if [[ -d node_modules && -f node_modules/.package-lock.json ]]; then
  echo "node_modules present, skipping. Delete it to force a clean install."
else
  npm ci
fi

step "2/5 firebase-tools"
PIN="$(tr -d '[:space:]' < .firebase-tools-version)"
if command -v firebase >/dev/null 2>&1 && [[ "$(firebase --version 2>/dev/null)" == "$PIN" ]]; then
  echo "firebase $PIN already on PATH."
else
  npm install -g "firebase-tools@$PIN"
  firebase --version
fi

step "3/5 emulator JARs"
# `Unable to fetch the CLI MOTD` on each of these is cosmetic:
# firebase-public.firebaseio.com is not on the egress allowlist and only carries
# the message of the day. The JARs themselves come down intact.
for component in firestore storage ui; do
  firebase "setup:emulators:$component"
done

step "4/5 Chromium revision shim"
PW_DIR="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
if [[ ! -d "$PW_DIR" ]]; then
  echo "No $PW_DIR. Nothing to shim; Playwright will try to download and fail."
else
  REV="$(node -e "const j=JSON.parse(require('fs').readFileSync('./node_modules/playwright-core/browsers.json','utf8'));console.log(j.browsers.find(x=>x.name==='chromium').revision)")"
  # The image ships a complete, working Chromium at an older revision. ldd reports
  # zero missing libraries, so only the revision number is in the way.
  SHIPPED_HEADFUL="$(ls -d "$PW_DIR"/chromium-* 2>/dev/null | grep -v "chromium-$REV\$" | head -1 || true)"
  SHIPPED_SHELL="$(ls -d "$PW_DIR"/chromium_headless_shell-* 2>/dev/null | grep -v "chromium_headless_shell-$REV\$" | head -1 || true)"
  if [[ -z "$SHIPPED_HEADFUL" || -z "$SHIPPED_SHELL" ]]; then
    echo "Could not find a shipped chromium under $PW_DIR. Skipping the shim."
  else
    echo "shimming revision $REV onto $(basename "$SHIPPED_HEADFUL")"
    mkdir -p "$PW_DIR/chromium-$REV/chrome-linux64" \
             "$PW_DIR/chromium_headless_shell-$REV/chrome-headless-shell-linux64"
    ln -sfn "$SHIPPED_HEADFUL/chrome-linux/chrome" \
            "$PW_DIR/chromium-$REV/chrome-linux64/chrome"
    ln -sfn "$SHIPPED_SHELL/chrome-linux/headless_shell" \
            "$PW_DIR/chromium_headless_shell-$REV/chrome-headless-shell-linux64/chrome-headless-shell"
    touch "$PW_DIR/chromium-$REV/INSTALLATION_COMPLETE" \
          "$PW_DIR/chromium-$REV/DEPENDENCIES_VALIDATED" \
          "$PW_DIR/chromium_headless_shell-$REV/INSTALLATION_COMPLETE" \
          "$PW_DIR/chromium_headless_shell-$REV/DEPENDENCIES_VALIDATED"
  fi
fi

step "5/5 CA certificates for Chromium"
# TLS is re-terminated on the way out and Chromium's own NSS store starts empty,
# so the site suite's real read of firestore.googleapis.com logs a certificate
# error and fails the zero-console-errors assertion. Two different issuers depending
# on whether the proxy env is set, so seed both.
if ! command -v certutil >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y libnss3-tools >/dev/null || \
      echo "apt-get install libnss3-tools failed. Seed the CAs by hand or expect the site console assertion to fail."
  else
    echo "No apt-get and no certutil. Skipping."
  fi
fi
if command -v certutil >/dev/null 2>&1; then
  NSSDB="${HOME}/.pki/nssdb"
  mkdir -p "$NSSDB"
  [[ -f "$NSSDB/cert9.db" ]] || certutil -d "sql:$NSSDB" -N --empty-password
  seeded=0
  for crt in "$HOME"/.ccr/agent-proxy-ca.crt "$HOME"/.ccr/ca-bundle.crt /etc/ssl/certs/ca-certificates.crt; do
    [[ -f "$crt" ]] || continue
    name="ccr-$(basename "$crt" .crt)"
    if certutil -d "sql:$NSSDB" -A -t "C,," -n "$name" -i "$crt" 2>/dev/null; then
      echo "seeded $name from $crt"
      seeded=$((seeded + 1))
    fi
  done
  [[ "$seeded" -gt 0 ]] || echo "No CA files found under ~/.ccr. The site console assertion may fail."
fi

cat <<'DONE'

Ready.

Run the suite with the proxy unset, or the emulator's own loopback calls are
refused by the agent proxy and the functions and admin suites crash:

  npm run test:cloud

Two things this box cannot do, both network policy, not code:
  - `npm run check:batch-001` against the live site. lailark.in is not on the
    egress allowlist. Use --url http://127.0.0.1:5010 against the hosting
    emulator, which still proves built page == printed jar.
  - Show anyone the dev server. It is localhost-only, no ingress. Screens Shefin
    checks need a staging deploy from his Mac.
DONE
