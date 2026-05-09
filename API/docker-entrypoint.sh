#!/bin/sh
set -e

mkdir -p /app/uploads/sow-pdf
chown -R node:node /app/uploads
chmod -R u+rwX,g+rwX /app/uploads

exec su-exec node "$@"
