#!/bin/sh
# Rubenchuelo en Mac o Linux (necesita Node.js 18 o más moderno instalado).
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  exec node app/servidor.js "$@"
fi
echo "Para usar Rubenchuelo en este sistema necesitas instalar Node.js: https://nodejs.org"
exit 1
