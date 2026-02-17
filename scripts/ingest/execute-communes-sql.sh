#!/bin/bash
#
# Execute all communes batch SQL files against Supabase
#
# Usage: bash scripts/ingest/execute-communes-sql.sh
#

set -e  # Exit on error

DB_URL="postgresql://postgres:M1cK6C9f7dLjkxBi@db.jquglrlwicryiajgfbel.supabase.co:5432/postgres"
SQL_DIR="scripts/ingest/sql"

echo "ArchiMap Communes SQL Execution"
echo "================================"
echo ""

# Check if SQL directory exists
if [ ! -d "$SQL_DIR" ]; then
  echo "Error: SQL directory not found: $SQL_DIR"
  echo "Please run: bun run scripts/ingest/generate-communes-sql.ts first"
  exit 1
fi

# Count batch files
BATCH_COUNT=$(ls -1 "$SQL_DIR"/communes-batch-*.sql 2>/dev/null | wc -l)

if [ "$BATCH_COUNT" -eq 0 ]; then
  echo "Error: No batch SQL files found in $SQL_DIR"
  echo "Please run: bun run scripts/ingest/generate-communes-sql.ts first"
  exit 1
fi

echo "Found $BATCH_COUNT batch files to execute"
echo ""

# Execute each batch file
COUNTER=0
for sql_file in "$SQL_DIR"/communes-batch-*.sql; do
  COUNTER=$((COUNTER + 1))
  filename=$(basename "$sql_file")

  echo "[$COUNTER/$BATCH_COUNT] Executing $filename..."

  psql "$DB_URL" -f "$sql_file" -q

  if [ $? -eq 0 ]; then
    echo "  ✓ Success"
  else
    echo "  ✗ Failed"
    exit 1
  fi
done

echo ""
echo "✓ All batches executed successfully!"
echo ""

# Show final count
echo "Verifying final count..."
psql "$DB_URL" -c "SELECT COUNT(*) as total_communes FROM communes;"
echo ""
echo "Sample communes with all fields populated:"
psql "$DB_URL" -c "SELECT code, nom, code_departement, code_region FROM communes WHERE code_region IS NOT NULL LIMIT 5;"
echo ""
echo "Departement distribution:"
psql "$DB_URL" -c "SELECT code_departement, COUNT(*) as count FROM communes GROUP BY code_departement ORDER BY code_departement LIMIT 10;"
