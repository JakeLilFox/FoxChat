#!/usr/bin/env sh
export LD_LIBRARY_PATH="/opt/webkit-webdriver/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
exec /opt/webkit-webdriver/WebKitWebDriver "$@"
