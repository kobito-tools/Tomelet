#!/bin/zsh
cd "${0:A:h}"
/usr/bin/env node scripts/setup.js
status=$?
echo ""
read "reply?Enterキーで閉じます..."
exit $status
