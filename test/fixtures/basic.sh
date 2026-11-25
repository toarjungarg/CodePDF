#!/bin/bash
# Made-up backup helper for a small notes folder. Nothing here is real.
# The words if then "quotes" in this comment are just comment text.

set -eu
NOTES_DIR="${1:-./notes}"   # the folder to back up
KEEP=5
count=0

# Comments only start at the start of a word, so these have none:
echo "args: $# last: ${#NOTES_DIR} id: $$ status: $?"
name="${NOTES_DIR##*/}"
echo "a#b ${name#note_} ${name%%.*}"
echo \# not a comment, \"not a string\"

usage() {
  echo 'Usage: backup.sh [dir]  (no $escapes or \n in single quotes)'
  echo 'ends with a backslash\'
  echo $'tab\there and an escaped \' quote'
}

log() {
  local level="$1"
  shift
  echo "[$level] $* at $(date +%H:%M)"
}

# Quotes inside $( ) inside "..." do not end the outer string.
stamp="$(echo "run on $(date +%F)")"
greeting="He said \"hi\" to $USER, home is ${HOME}."
list=(alpha beta "gamma delta")

if [ -d "$NOTES_DIR" ] && [[ "$name" != *.tmp ]]; then
  log INFO "backing up $NOTES_DIR"
elif [ ! -e "$NOTES_DIR" ]; then
  log ERROR "missing folder"
  exit 1
else
  usage
fi

for file in "$NOTES_DIR"/*.txt; do
  count=$((count + 1))
  cp "$file" "$file.bak" || true
done

for ((i = 0; i < KEEP; i++)); do
  echo "slot $i"
done

while read -r line; do
  [ -z "$line" ] && continue
  printf '%s\n' "$line"
done < "$NOTES_DIR/index.txt"

case "$1" in
  -h|--help)
    usage
    ;;
  start | begin)
    log INFO "starting"
    ;;
  (stop)
    log INFO "stopping"
    ;;
  *)
    echo "unknown: $1" >&2
    ;;
esac

# A heredoc is a string. The terminator must be alone on its line.
cat <<EOF
Backup of $NOTES_DIR
if then fi # not a comment in here
EOF

cat <<-'END' > summary.txt
	Quoted tag: $NOTES_DIR stays as it is.
	END

# A here-string is not a heredoc.
wc -w <<< "$greeting"

total=$(( (count * 2) << 1 ))
echo "total: $total" `date`

cat <<LAST
This heredoc is never closed, so it runs to the end of the file.
echo "still inside"
