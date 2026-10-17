# Sourced by the bin/ shims. Sets NODE (node binary) and RUN (package root that has its
# dependencies installed), following the layout written by `pantrybase install`.

PB_HOME="${PANTRYBASE_HOME:-$HOME/.pantrybase}"

# Package root: the directory above bin/, wherever this copy lives.
DIR="$(cd "$(dirname "$PB_SELF")/.." && pwd)"

# Node: the binary pinned at install time (so nvm/volta PATH changes never matter), else PATH.
NODE=""
if [ -f "$PB_HOME/node-path" ]; then
  NODE="$(cat "$PB_HOME/node-path" 2>/dev/null)"
fi
if [ ! -x "$NODE" ]; then
  NODE="$(command -v node 2>/dev/null)"
fi

# Native dependencies live either inside the package (dev checkout, npm -g) or beside it
# (stable copy inside ~/.pantrybase/plugin/node_modules).
pb_runnable() {
  [ -f "$1/dist/server.js" ] && { [ -e "$1/node_modules/better-sqlite3/package.json" ] || [ -e "$1/../better-sqlite3/package.json" ]; }
}

RUN="$DIR"
if ! pb_runnable "$DIR"; then
  RUN=""
  if [ -f "$PB_HOME/root-path" ]; then
    ALT="$(cat "$PB_HOME/root-path" 2>/dev/null)"
    if [ -n "$ALT" ] && pb_runnable "$ALT"; then
      RUN="$ALT"
    fi
  fi
fi

if [ -z "$NODE_COMPILE_CACHE" ]; then
  NODE_COMPILE_CACHE="$PB_HOME/compile-cache"
  export NODE_COMPILE_CACHE
fi
