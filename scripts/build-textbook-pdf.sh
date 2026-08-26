#!/usr/bin/env bash
# Thin wrapper: page images → tesseract hOCR (line boxes) → build-textbook-pdf.py
# (VLM text aligned into those boxes + outline + page labels). See the .py for why.
#   build-textbook-pdf.sh <scan.pdf> <vlm-txt-dir> <toc.json> <out.pdf> [pages-png-dir]
set -euo pipefail
SRC=$1; TXT=$2; TOC=$3; OUT=$4; PNG=${5:-/tmp/book-pages}; HOCR=${HOCR_DIR:-/tmp/book-hocr}
mkdir -p "$PNG" "$HOCR"
[ -s "$PNG/pg-001.png" ] || pdftoppm -r 200 -png "$SRC" "$PNG/pg"
# OMP_THREAD_LIMIT=1: tesseract's own threads thrash when run 48-way (load 100+, minutes per page).
ls "$PNG"/pg-*.png | OMP_THREAD_LIMIT=1 xargs -P "$(nproc)" -I{} sh -c 'b=$(basename {} .png); [ -s "'"$HOCR"'/$b.hocr" ] || tesseract {} "'"$HOCR"'/$b" -l eng --psm 3 hocr >/dev/null 2>&1'
python3 "$(dirname "$0")/build-textbook-pdf.py" "$SRC" "$TXT" "$HOCR" "$TOC" "$OUT"
