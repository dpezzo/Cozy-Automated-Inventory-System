#!/bin/sh
set -e
node dist/db/migrate.js
node dist/db/seed.js
exec node dist/index.js
