#!/usr/bin/env bash

set -euo pipefail

for argument in "$@"; do
	if [ "$argument" = "--no-sign" ]; then
		exit 0
	fi
done

if [ "${OPEN_GRIND_ALLOW_PROVISIONING_UPDATES:-}" != "1" ]; then
	echo "Signed iOS builds let Xcode update Apple provisioning. Set OPEN_GRIND_ALLOW_PROVISIONING_UPDATES=1 only with explicit Apple portal mutation authority." >&2
	exit 1
fi

if [ -z "${APPLE_DEVELOPMENT_TEAM:-}" ]; then
	echo "Signed iOS builds require APPLE_DEVELOPMENT_TEAM to identify the authorized Apple Developer team." >&2
	exit 1
fi
