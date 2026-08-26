#!/usr/bin/env python3
"""
build-textbook-pdf.py — scanned textbook → copy/paste-able PDF with real navigation.

  python3 build-textbook-pdf.py <scan.pdf> <vlm-txt-dir> <hocr-dir> <toc.json> <out.pdf>

Why two OCR passes:
  * tesseract (hOCR) knows WHERE every line is on the page (bounding boxes) but
    mangles code ("£(&x) 5;").
  * qwen2.5-vl (vlm-book.py) reads code verbatim but has no coordinates.
  We align the VLM's lines to tesseract's line boxes (monotonic DP on text
  similarity) and paint the VLM text invisibly INTO those boxes, so clicking
  and dragging on the scan selects the words under the cursor. Lines only one
  side found fall back sensibly (tesseract text in its box / VLM text placed
  between its neighbours) so select-all and search still get everything.

Also adds: a PDF outline (bookmarks) from toc.json and page labels so the
viewer's page number equals the printed page number (the scan is missing a
few leaves, so the printed→PDF offset changes twice).
"""
import io, json, os, re, sys
from difflib import SequenceMatcher
from html.parser import HTMLParser

import pikepdf
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

FONT = "Helvetica"


# ---------- hOCR ----------
class HocrLines(HTMLParser):
    """Collect ocr_line elements → [{bbox:(x0,y0,x1,y1), text}], plus page size."""
    def __init__(self):
        super().__init__(); self.lines = []; self.page = None; self._line = None; self._word = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs); cls = a.get("class", ""); title = a.get("title", "")
        bb = re.search(r"bbox (\d+) (\d+) (\d+) (\d+)", title)
        if cls == "ocr_page" and bb: self.page = tuple(map(int, bb.groups()))
        elif cls in ("ocr_line", "ocr_header", "ocr_caption", "ocr_textfloat") and bb:
            self._line = {"bbox": tuple(map(int, bb.groups())), "words": []}
        elif cls == "ocrx_word": self._word = True
    def handle_endtag(self, tag):
        if self._word and tag == "span": self._word = False
        elif self._line is not None and tag == "span" and not self._word:
            t = " ".join(w for w in self._line["words"] if w)
            if t.strip(): self.lines.append({"bbox": self._line["bbox"], "text": t})
            self._line = None
    def handle_data(self, data):
        if self._line is not None and self._word and data.strip(): self._line["words"].append(data.strip())


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def clean_vlm(text):
    out = []
    for l in text.splitlines():
        l = re.sub(r"^```.*$", "", l)
        l = re.sub(r"^#{1,6}\s+", "", l)             # markdown headings ("# Title") — NOT #include/#define
        l = l.replace("**", "").replace("|", " ")     # bold / table pipes
        l = re.sub(r"\s{2,}", " ", l).strip()
        if l and not re.fullmatch(r"[-: ]+", l): out.append(l)
    return out


def align(tess, vlm):
    """Monotonic alignment tess[i] ↔ vlm[j]. Returns list of (i or None, j or None)."""
    n, m = len(tess), len(vlm)
    if not n or not m: return [(i, None) for i in range(n)] + [(None, j) for j in range(m)]
    tn = [norm(t["text"]) for t in tess]; vn = [norm(v) for v in vlm]
    sim = [[0.0] * m for _ in range(n)]
    for i in range(n):
        for j in range(max(0, i - 25), min(m, i + 26)):          # band: pages have <~80 lines
            if tn[i] and vn[j]:
                r = SequenceMatcher(None, tn[i], vn[j]).ratio()
                if r >= 0.35: sim[i][j] = r
    # DP: maximise sum of similarities of matched pairs (gaps cost 0)
    S = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            S[i][j] = max(S[i - 1][j], S[i][j - 1], S[i - 1][j - 1] + sim[i - 1][j - 1])
    pairs = []; i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and sim[i - 1][j - 1] > 0 and S[i][j] == S[i - 1][j - 1] + sim[i - 1][j - 1]:
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i > 0 and S[i][j] == S[i - 1][j]: pairs.append((i - 1, None)); i -= 1
        else: pairs.append((None, j - 1)); j -= 1
    return pairs[::-1]


def paint_page(c, w, h, tess, vlm, img_wh):
    iw, ih = img_wh; sx, sy = w / iw, h / ih
    pairs = align(tess, vlm)
    placed = []                       # (y_top, y_bot, x0, x1, text) in PDF units
    last_box = None
    for i, j in pairs:
        if i is not None:
            x0, y0, x1, y1 = tess[i]["bbox"]
            box = (x0 * sx, h - y1 * sy, x1 * sx, h - y0 * sy)   # PDF coords (bottom-up)
            text = vlm[j] if j is not None else tess[i]["text"]
            placed.append((box, text)); last_box = box
        elif j is not None:
            # VLM-only line (tesseract merged or missed it): put it right under the last box, tiny.
            if last_box: bx0, by0, bx1, by1 = last_box; box = (bx0, by0 - 4, bx1, by0)
            else: box = (18, h - 22, w - 18, h - 18)
            placed.append((box, vlm[j])); last_box = box
    t = c.beginText(); t.setTextRenderMode(3)
    for (x0, y0, x1, y1), text in placed:
        bh = max(y1 - y0, 3.0); fs = max(min(bh * 0.8, 24), 3.0)
        sw = stringWidth(text, FONT, fs) or 1.0
        scale = max(min((x1 - x0) / sw * 100, 300), 20)
        t.setFont(FONT, fs); t.setHorizScale(scale)
        t.setTextOrigin(x0, y0 + bh * 0.2); t.textOut(text)
    c.drawText(t)


def add_outline_and_labels(pdf, toc):
    with pdf.open_outline() as outline:
        outline.root.clear()
        for ch in toc["chapters"]:
            pp = ch.get("pdfPage")
            if not pp: continue
            title = f"{ch['chapter']}. {ch['title']}" if ch.get("chapter") else ch["title"]
            item = pikepdf.OutlineItem(title, pp - 1)
            for s in ch.get("sections", []):
                if s.get("pdfPage"): item.children.append(pikepdf.OutlineItem(s["title"], s["pdfPage"] - 1))
            outline.root.append(item)
    labels = toc.get("pageLabels")
    if labels:
        nums = pikepdf.Array()
        r0, r1 = labels["roman"]
        nums.append(r0 - 1); nums.append(pikepdf.Dictionary(S=pikepdf.Name("/r")))
        for pdf_start, printed_start in labels["segments"]:
            nums.append(pdf_start - 1); nums.append(pikepdf.Dictionary(S=pikepdf.Name("/D"), St=printed_start))
        pdf.Root.PageLabels = pikepdf.Dictionary(Nums=nums)


def main():
    src, txtdir, hocrdir, tocpath, out = sys.argv[1:6]
    pdf = pikepdf.open(src)
    ov = io.BytesIO(); c = None; stats = {"matched": 0, "tess_only": 0, "vlm_only": 0}
    for i, page in enumerate(pdf.pages, start=1):
        w = float(page.mediabox[2] - page.mediabox[0]); h = float(page.mediabox[3] - page.mediabox[1])
        if c is None: c = canvas.Canvas(ov, pagesize=(w, h))
        else: c.setPageSize((w, h))
        vp = os.path.join(txtdir, f"pg-{i:03d}.txt"); hp = os.path.join(hocrdir, f"pg-{i:03d}.hocr")
        vlm = clean_vlm(open(vp).read()) if os.path.exists(vp) else []
        hl = HocrLines()
        if os.path.exists(hp): hl.feed(open(hp, encoding="utf8").read())
        tess = hl.lines; img_wh = (hl.page[2], hl.page[3]) if hl.page else (int(w * 200 / 72), int(h * 200 / 72))
        for a, b in align(tess, vlm):
            stats["matched" if a is not None and b is not None else ("tess_only" if a is not None else "vlm_only")] += 1
        paint_page(c, w, h, tess, vlm, img_wh)
        c.showPage()
    c.save()
    ovpdf = pikepdf.open(io.BytesIO(ov.getvalue()))
    for page, opage in zip(pdf.pages, ovpdf.pages): page.add_overlay(opage)
    toc = json.load(open(tocpath))
    add_outline_and_labels(pdf, toc)
    pdf.save(out, linearize=True)
    print("wrote", out, "pages", len(pdf.pages), "line alignment:", stats)


if __name__ == "__main__":
    main()
