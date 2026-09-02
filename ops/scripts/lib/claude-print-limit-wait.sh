#!/usr/bin/env bash
#
# claude-print-limit-wait.sh — helpers that turn a claude.ai usage-limit notice into a
# bounded wait: detect the notice, read the announced reset time, compute the seconds to
# sleep. Sourced by claude-batch-core.sh (core_invoke_claude_print, « cap wait-once »).
# Functions only — no side effects at source time.
#
# WHY THIS EXISTS (2026-09-02)
#   In an interactive session, Claude Code >= 2.1.234 waits on its own when a claude.ai usage
#   limit is hit and continues after the reset (setting `autoContinueAtUsageLimit`). In
#   `--print` mode it does NOT ("Background sessions and -p runs: the menu row isn't
#   available", code.claude.com/docs/en/interactive-mode, read 2026-09-02). The worker already
#   halts a capped batch (exit 75) and cools down 60 min between ticks, which is right for the
#   pipelines that tick every few minutes. The weekly, monthly, calendar and profile pipelines
#   tick once per week/month/day: for them a cap meant losing the whole run. The core now waits
#   once until the ANNOUNCED reset, then retries the member once. These helpers do the reading.
#
# DETECTION — messages measured on this machine (~/.claude/.api-errors-detail.json, 2026-09-02):
#     "You've hit your session limit · resets 5:50am (Europe/Paris)"
#     "You've hit your session limit · resets 8pm (Europe/Paris)"
#     "API Error: Rate limited"
#   plus the documented variants "You've hit your weekly limit", "usage limit", and an HTTP 429
#   written WITH its context ("error ... 429", "429 too many requests") — a bare "429" inside a
#   model answer is not a limit. The reset time is the 12-hour clock with an optional ":mm",
#   followed by the IANA zone in parentheses. A weekly limit resets days later: never waited for.
#
#   Git Bash (MSYS2, coreutils 8.32 on this machine) ships NO tz database: TZ=Asia/Tokyo behaves
#   like UTC (measured 2026-09-02). When zone names are not honoured, an announced time in the
#   machine's own zone (CLAUDE_LIMIT_LOCAL_ZONE, default Europe/Paris) is parsed in local time,
#   which is exact; a time announced in ANY OTHER zone is treated as unparseable rather than
#   parsed in the wrong zone, because a zone mistake combined with the "already passed ->
#   tomorrow" rule could shorten the wait or push it a day away. The VPS worker runs with a full
#   tz database, where the announced zone is honoured directly.
#
# ENVIRONMENT (all optional)
#     CLAUDE_LIMIT_MARGIN_S        seconds added after the reset time (default 90; the client's
#                                  own auto-continue adds a 30-90 s jitter for the same reason)
#     CLAUDE_LIMIT_JITTER_S        max random extra seconds (default 60; 0 disables)
#     CLAUDE_LIMIT_FALLBACK_WAIT_S seconds returned by _cplw_wait_seconds when no reset epoch is
#                                  given (default 900); the core never uses that path
#     CLAUDE_LIMIT_LOCAL_ZONE      IANA name of the machine's zone (default Europe/Paris)
#     CLAUDE_LIMIT_NOW_EPOCH       fixed "now" for tests (default: date +%s)
#
# REQUIREMENTS: bash >= 4, GNU date (`date -d`). Without GNU date nothing parses and the core
#   keeps today's halt-and-cooldown behaviour.

_cplw_now() {
  if [ -n "${CLAUDE_LIMIT_NOW_EPOCH:-}" ]; then
    printf '%s' "$CLAUDE_LIMIT_NOW_EPOCH"
  else
    date +%s
  fi
}

# True when GNU date honours IANA zone names (false under Git Bash without tzdata).
_cplw_tz_supported() {
  [ "$(TZ=Asia/Tokyo date -d @0 +%H 2>/dev/null)" = "09" ]
}

# _cplw_date <zone-or-empty> <date args...> : run date in the given zone, or in the local zone.
_cplw_date() {
  local zone="$1"
  shift
  if [ -n "$zone" ]; then TZ="$zone" date "$@"; else date "$@"; fi
}

# True when the text carries a usage-limit / rate-limit message.
_cplw_is_limit() {
  printf '%s' "$1" | grep -qiE \
    "hit your [a-z ]{0,20}limit|usage limit|weekly limit|session limit|rate[ _-]?limit|too many requests|(http|status|error|code)[^0-9]{0,12}429"
}

# True when the limit is the weekly one (resets days later: never worth waiting in a batch).
_cplw_is_weekly() {
  printf '%s' "$1" | grep -qiE "weekly limit|hit your weekly"
}

# Print the epoch of the announced reset, or nothing when it cannot be parsed.
#   "resets 5:50am (Europe/Paris)" / "resets 8pm (Europe/Paris)" / "resets at 3:45pm"
#   "resets|1725292800" (older pipe+epoch form) is accepted as well.
_cplw_parse_reset_epoch() {
  local text="$1" now line hh mm ampm tz epoch day tzuse
  now="$(_cplw_now)"

  # Older form: an epoch after a pipe.
  epoch="$(printf '%s' "$text" | grep -oE '\|[0-9]{10}' | head -1 | tr -d '|')"
  if [ -n "$epoch" ]; then printf '%s' "$epoch"; return 0; fi

  line="$(printf '%s' "$text" | grep -oiE 'resets( at)? [0-9]{1,2}(:[0-9]{2})?(am|pm)( \([A-Za-z_/+-]+\))?' | head -1)"
  [ -z "$line" ] && return 0
  hh="$(printf '%s' "$line" | grep -oE '[0-9]{1,2}(:[0-9]{2})?' | head -1 | cut -d: -f1)"
  mm="$(printf '%s' "$line" | grep -oE ':[0-9]{2}' | head -1 | tr -d ':')"
  ampm="$(printf '%s' "$line" | grep -oiE '(am|pm)' | head -1 | tr 'A-Z' 'a-z')"
  tz="$(printf '%s' "$line" | grep -oE '\([A-Za-z_/+-]+\)' | head -1 | tr -d '()')"
  [ -z "$mm" ] && mm="00"

  tzuse=""
  if [ -n "$tz" ]; then
    if _cplw_tz_supported; then
      tzuse="$tz"
    elif [ "$tz" != "${CLAUDE_LIMIT_LOCAL_ZONE:-Europe/Paris}" ]; then
      # Zone names not honoured and the announced zone is not the machine's: refuse to guess.
      return 0
    fi
  fi

  # GNU date only; anything else -> no parse.
  day="$(_cplw_date "$tzuse" -d "@$now" +"%Y-%m-%d" 2>/dev/null)" || return 0
  [ -z "$day" ] && return 0
  epoch="$(_cplw_date "$tzuse" -d "$day $hh:$mm$ampm" +%s 2>/dev/null)" || return 0
  [ -z "$epoch" ] && return 0
  # The announced clock time is always in the future; if it already passed today, it is tomorrow.
  if [ "$epoch" -le "$now" ]; then epoch=$((epoch + 86400)); fi
  printf '%s' "$epoch"
}

# Seconds to wait for a given (possibly empty) reset epoch.
_cplw_wait_seconds() {
  local reset_epoch="$1" now margin jitter fallback secs
  now="$(_cplw_now)"
  margin="${CLAUDE_LIMIT_MARGIN_S:-90}"
  fallback="${CLAUDE_LIMIT_FALLBACK_WAIT_S:-900}"
  jitter="${CLAUDE_LIMIT_JITTER_S:-60}"
  if [ -n "$reset_epoch" ] && [ "$reset_epoch" -gt "$now" ]; then
    secs=$((reset_epoch - now + margin))
  else
    secs="$fallback"
  fi
  if [ "$jitter" -gt 0 ]; then secs=$((secs + RANDOM % (jitter + 1))); fi
  printf '%s' "$secs"
}
