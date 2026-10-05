#!/usr/bin/env bash
# 把 install.sh 建的捷徑拿掉。只刪指到這個 repo 的捷徑，不碰 repo 本身。
set -euo pipefail
repo=$(cd "$(dirname "$0")" && pwd)
target="$HOME/.claude/skills/timeline"
if [ -L "$target" ] && [ "$(readlink "$target")" = "$repo" ]; then
  rm "$target"; echo "已拿掉 ${target}"
else
  echo "${target} 不是指到這個 repo 的捷徑，沒動。"
fi
