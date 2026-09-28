#!/bin/zsh
cd "${0:A:h}"
/usr/bin/env node scripts/launch.js
status=$?
if [[ $status -ne 0 ]]; then
  echo ""
  read "reply?Enterキーで閉じます..."
fi
exit $status
