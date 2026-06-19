#!/bin/sh
# Run a command (typically `npm ...`) with Aikido safe-chain shims on PATH so
# any package install is screened against the malware list. Used by lefthook
# so local commits/pushes get the same protection as the developer's
# interactive shell. Fails loudly when safe-chain is missing — silent skips
# would defeat the point.

set -e

SHIMS_DIR="${HOME}/.safe-chain/shims"

# Windows safe-chain creates `npm.cmd` shims; POSIX setups create `npm`.
if [ ! -x "${SHIMS_DIR}/npm" ] && [ ! -f "${SHIMS_DIR}/npm.cmd" ]; then
  cat >&2 <<'EOF'
* Aikido safe-chain is not installed.
  This hook refuses to run npm without malware screening.

  Install it once:
      npm install -g @aikidosec/safe-chain
      safe-chain setup
      safe-chain setup-ci

  Then retry your git command. To bypass in an emergency:
      LEFTHOOK=0 git <command>     # or  git <command> --no-verify
EOF
  exit 1
fi

PATH="${SHIMS_DIR}:${PATH}"
export PATH
exec "$@"
