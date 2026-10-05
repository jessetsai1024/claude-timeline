#!/usr/bin/env bash
# 把這個 mod 接進 ~/.claude/skills/timeline（符號連結），Claude Code 下次開啟就會自動載入。
# 再跑一次是安全的：已經是捷徑的會重接；那個位置有真的資料夾就不動。
set -euo pipefail
repo=$(cd "$(dirname "$0")" && pwd)
target="$HOME/.claude/skills/timeline"
mkdir -p "$HOME/.claude/skills"
if [ -L "$target" ]; then rm "$target"
elif [ -e "$target" ]; then echo "${target} 已存在而且不是捷徑，請自己處理" >&2; exit 1; fi
ln -s "$repo" "$target"
settings="$HOME/.claude/settings.json"
if [ -f "$settings" ] && grep -q CLAUDE_CODE_PLUGIN_DIRS "$settings"; then
  echo "注意：${settings} 裡有 CLAUDE_CODE_PLUGIN_DIRS；如果它也指到這個 mod，會載入兩次，請拿掉其中一邊。" >&2
fi
echo "已接上 timeline -> ${target}；關掉再重開 Claude Code 就會看到。"
