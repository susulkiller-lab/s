#!/bin/sh
# 전체 시험: 단위, DOCX 실물(+PDF 변환), DOM 이벤트 흐름.
# jsdom은 저장소 밖에 설치하고 NODE_PATH로 알려 준다.
#   예) NODE_PATH=/경로/node_modules sh tests/run-all.sh
cd "$(dirname "$0")/.." || exit 1
status=0
node tests/unit.test.js || status=1
node tests/docx.test.js || status=1
node tests/dom.test.js || status=1
exit $status
