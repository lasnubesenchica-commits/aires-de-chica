#!/bin/sh
# Todas las pruebas. Viven en el repositorio y no en un directorio temporal porque una
# vez se perdieron ahí: el contenedor se recicló y se llevó doscientas afirmaciones que
# no estaban en ningún commit.
cd "$(dirname "$0")"
mal=0
for t in *_test.js; do
  printf '%-24s ' "$t"
  if NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}" node "$t" >/dev/null 2>&1; then echo "verde"; else echo "ROJO"; mal=1; NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}" node "$t" 2>&1 | grep -E "NO PASA|Error" | head -5; fi
done
exit $mal
