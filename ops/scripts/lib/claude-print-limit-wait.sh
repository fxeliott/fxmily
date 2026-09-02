#!/usr/bin/env bash
#
# claude-print-limit-wait.sh — wait for a claude.ai usage-limit reset around `claude --print`.
#
# WHY THIS EXISTS (2026-09-02)
#   In an interactive session, Claude Code >= 2.1.234 waits on its own when a claude.ai usage
#   limit is hit and continues the task after the reset (setting `autoContinueAtUsageLimit`).
#   In `--print` mode it does NOT: "Background sessions and -p runs: the menu row isn't
#   available" (code.claude.com/docs/en/interactive-mode, "Wait for a usage limit to reset",
#   read 2026-09-02). A batch that hits the 5-hour cap therefore fails every remaining member
#   with `claude_exit_1` and an empty response. This helper closes that gap for the two batch
#   scripts (weekly, monthly): detect the limit, wait until the announced reset, retry.
#
# CONTRACT
#   claude_print_with_limit_wait <prompt_file> <response_file> <errors_log> -- <claude args...>
#     - stdin of claude  = <prompt_file> ; stdout = <response_file> (truncated at each attempt) ;
#       stderr is appended to <errors_log> with an attempt header.
#     - returns claude's exit code of the LAST attempt (0 on success) for any failure that is not
#       a usage limit, and 75 (EX_TEMPFAIL) when it gives up on a usage limit: weekly limit,
#       wait budget exhausted, retries exhausted, or reset time unparseable twice. The callers
#       record that code as `claude_exit_75`, which tells the limit apart from a model failure.
#     - errexit (`set -e`) is switched off INSIDE the function and restored on return, so a
#       failing claude attempt can never abort the function half-way (it must be able to
#       retry). What no function can do is shield its CALLER from errexit: bash acts on the
#       function's own exit status at the call site. Both batch scripts therefore keep the
#       documented pattern around the call: `set +e` ; call ; `CLAUDE_EXIT=$?` ; `set -e`.
#     - retries ONLY on a usage-limit / rate-limit message. Any other failure returns at once.
#
#   Environment (all optional):
#     CLAUDE_LIMIT_MAX_RETRIES     max retries after a limit (default 3 -> 4 attempts total)
#     CLAUDE_LIMIT_MAX_WAIT_S      total wait budget in seconds for the WHOLE batch (default
#                                  21600 = 6 h), accumulated in CPLW_WAITED_TOTAL across calls.
#                                  A wait that would exceed the remaining budget gives up at once.
#     CLAUDE_LIMIT_FALLBACK_WAIT_S wait when no reset time can be parsed (default 900 = 15 min).
#                                  Used ONCE per call; a second unparseable message gives up.
#     CLAUDE_LIMIT_MARGIN_S        seconds added after the reset time (default 90 ; the client's
#                                  own auto-continue adds a 30-90 s jitter for the same reason)
#     CLAUDE_LIMIT_JITTER_S        max random extra seconds (default 60 ; 0 disables)
#     CLAUDE_LIMIT_LOCAL_ZONE      IANA name of the machine's zone (default Europe/Paris) ; only
#                                  used when GNU date has no tz database (see DETECTION)
#     CLAUDE_BIN                   binary to run (default: claude)
#     CLAUDE_LIMIT_SLEEP_CMD       command used to sleep (default: sleep) — tests replace it
#     CLAUDE_LIMIT_NOW_EPOCH       fixed "now" for tests (default: date +%s)
#     CPLW_WAITED_TOTAL            running total of seconds waited (set by the lib, readable by
#                                  the caller ; reset it to 0 to start a new budget)
#
# DETECTION — messages measured on this machine (~/.claude/.api-errors-detail.json, 2026-09-02):
#     "You've hit your session limit · resets 5:50am (Europe/Paris)"
#     "You've hit your session limit · resets 8pm (Europe/Paris)"
#     "API Error: Rate limited"
#   plus the documented variants "You've hit your weekly limit", "usage limit", and an HTTP 429
#   written WITH its context ("error ... 429", "429 too many requests") — a bare "429" inside a
#   model answer is not a limit. Only stderr is examined ; the response body is examined only when
#   stderr is empty. The reset time is the 12-hour clock with an optional ":mm", followed by the
#   IANA zone in parentheses. A weekly limit resets days later: the helper never waits for it.
#
#   Git Bash (MSYS2, coreutils 8.32 on this machine) ships NO tz database: TZ=Asia/Tokyo behaves
#   like UTC (measured 2026-09-02). When zone names are not honoured, an announced time in the
#   machine's own zone (CLAUDE_LIMIT_LOCAL_ZONE) is parsed in local time, which is exact ; a time
#   announced in ANY OTHER zone is treated as unparseable (fallback wait) rather than parsed in the
#   wrong zone, because a zone mistake combined with the "already passed -> tomorrow" rule could
#   shorten the wait or push it a day away.
#
# REQUIREMENTS: bash >= 4, GNU date (`date -d`, present in Git Bash). Without GNU date the
#   helper still works, with the fallback wait only.

# --- internals ---------------------------------------------------------------------------------

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

  # GNU date only; anything else -> no parse -> fallback wait.
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

# --- public --------------------------------------------------------------------------------------

claude_print_with_limit_wait() {
  # Self-protection against errexit: the caller's `set -e` must never turn a non-zero exit of
  # claude into an exit of the caller. Saved here, restored before every return.
  local _cplw_e=0
  case $- in *e*) _cplw_e=1; set +e ;; esac

  local prompt_file="$1" response_file="$2" errors_log="$3"
  shift 3
  if [ "${1:-}" != "--" ]; then
    echo "claude_print_with_limit_wait: expected '--' before claude arguments" >&2
    [ "$_cplw_e" = 1 ] && set -e
    return 64
  fi
  shift

  local bin="${CLAUDE_BIN:-claude}"
  local max_retries="${CLAUDE_LIMIT_MAX_RETRIES:-3}"
  local max_wait="${CLAUDE_LIMIT_MAX_WAIT_S:-21600}"
  local sleep_cmd="${CLAUDE_LIMIT_SLEEP_CMD:-sleep}"
  local attempt=0 fallbacks=0 giveup=0 rc=0 err_tmp text reset_epoch secs
  CPLW_WAITED_TOTAL="${CPLW_WAITED_TOTAL:-0}"

  err_tmp="$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/cplw-$$.err")"

  while :; do
    : >"$err_tmp"
    "$bin" --print "$@" <"$prompt_file" >"$response_file" 2>"$err_tmp"
    rc=$?
    {
      printf -- '--- claude --print attempt %s exit %s (%s) ---\n' "$((attempt + 1))" "$rc" "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
      cat "$err_tmp"
    } >>"$errors_log" 2>/dev/null || true

    # Success = exit 0 with a non-empty response.
    if [ "$rc" -eq 0 ] && [ -s "$response_file" ]; then break; fi

    # The limit message arrives on stderr (measured). The response body is only looked at when
    # stderr is empty, and even then a bare "429" in prose is not a limit (see _cplw_is_limit).
    text="$(cat "$err_tmp" 2>/dev/null)"
    if [ -z "$text" ]; then text="$(head -c 4096 "$response_file" 2>/dev/null)"; fi
    if ! _cplw_is_limit "$text"; then break; fi

    reset_epoch="$(_cplw_parse_reset_epoch "$text")"
    if [ -z "$reset_epoch" ] && _cplw_is_weekly "$text"; then
      echo "  ! weekly usage limit: it resets days later, not waiting — giving up" >&2
      giveup=1; break
    fi
    if [ "$attempt" -ge "$max_retries" ]; then
      echo "  ! usage limit still active after $((attempt + 1)) attempts — giving up" >&2
      giveup=1; break
    fi
    if [ -z "$reset_epoch" ]; then
      if [ "$fallbacks" -ge 1 ]; then
        echo "  ! usage limit with no parseable reset time, twice — giving up" >&2
        giveup=1; break
      fi
      fallbacks=$((fallbacks + 1))
    fi
    secs="$(_cplw_wait_seconds "$reset_epoch")"
    if [ $((CPLW_WAITED_TOTAL + secs)) -gt "$max_wait" ]; then
      echo "  ! usage limit: next wait ${secs}s would exceed the batch budget (${CPLW_WAITED_TOTAL}s used of ${max_wait}s) — giving up" >&2
      giveup=1; break
    fi
    if [ -n "$reset_epoch" ]; then
      echo "  ⏳ usage limit hit — waiting ${secs}s until the announced reset ($(date -d "@$reset_epoch" +%H:%M 2>/dev/null || echo "epoch $reset_epoch")) then retrying" >&2
    else
      echo "  ⏳ usage limit hit — no reset time parsed, waiting ${secs}s then retrying" >&2
    fi
    "$sleep_cmd" "$secs"
    CPLW_WAITED_TOTAL=$((CPLW_WAITED_TOTAL + secs))
    attempt=$((attempt + 1))
  done

  rm -f "$err_tmp" 2>/dev/null || true
  if [ "$giveup" -eq 1 ]; then rc=75; fi
  [ "$_cplw_e" = 1 ] && set -e
  return "$rc"
}
