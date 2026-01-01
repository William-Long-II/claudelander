#!/bin/bash
# Claudelander hook script - reports Claude state to main process

SESSION_ID="${CLAUDELANDER_SESSION_ID}"
SOCKET_PATH="${CLAUDELANDER_SOCKET}"

report_state() {
    local state="$1"
    local event="$2"
    # Escape special JSON characters in SESSION_ID
    local safe_id=$(echo "$SESSION_ID" | sed 's/\\/\\\\/g; s/"/\\"/g')
    if [ -n "$SOCKET_PATH" ] && [ -S "$SOCKET_PATH" ]; then
        echo "{\"sessionId\":\"$safe_id\",\"state\":\"$state\",\"event\":\"$event\",\"timestamp\":$(date +%s)}" | nc -U "$SOCKET_PATH" 2>/dev/null || true
    fi
}

# Hook handlers based on Claude Code hook events
case "$1" in
    "PreToolUse")
        report_state "waiting" "tool_approval"
        ;;
    "PostToolUse")
        report_state "working" "tool_complete"
        ;;
    "Notification")
        report_state "working" "notification"
        ;;
    "Stop")
        report_state "idle" "stopped"
        ;;
esac

# Always exit 0 to not block Claude
exit 0
