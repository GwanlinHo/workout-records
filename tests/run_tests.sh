#!/bin/bash
# 完整測試：核心單元測試（兩個時區）+ 端到端瀏覽器測試（含離線、匯入匯出）
# 需求：node（~/.node-current）、chromium、puppeteer-core（browser-tool）
set -u
cd "$(dirname "$0")"
NODE=/home/pi/.node-current/bin/node
PORT=8131
python3 -m http.server "$PORT" --directory .. >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
sleep 1

FAIL=0
echo "===== 核心單元測試（Asia/Taipei）====="
TZ=Asia/Taipei $NODE core.test.js || FAIL=1
echo "===== 核心單元測試（America/New_York，有日光節約）====="
TZ=America/New_York $NODE core.test.js || FAIL=1
echo "===== 端到端 ====="
TZ=Asia/Taipei PORT=$PORT $NODE e2e.js || FAIL=1

if [ "$FAIL" = "0" ]; then echo "[O] ALL TEST SUITES PASSED"; else echo "[X] SOME TESTS FAILED"; fi
exit "$FAIL"
