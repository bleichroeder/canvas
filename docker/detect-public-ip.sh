#!/bin/sh
# Emits a public IPv4 address to stdout, or exits 1 if unreachable.
# Retries a handful of oracles because any single one can go down.
set -eu

try() {
  # $1: URL. curl with 3s connect + 4s total, quiet on error.
  ip=$(curl -sf --connect-timeout 3 --max-time 4 "$1" 2>/dev/null || true)
  # Strip whitespace and validate as IPv4.
  ip=$(printf '%s' "$ip" | tr -d ' \t\n\r')
  case "$ip" in
    *.*.*.*)
      if printf '%s' "$ip" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
        printf '%s\n' "$ip"
        exit 0
      fi
      ;;
  esac
  return 1
}

try https://api.ipify.org || \
  try https://ifconfig.me || \
  try https://icanhazip.com || {
  echo "detect-public-ip: no oracle reachable" >&2
  exit 1
}
