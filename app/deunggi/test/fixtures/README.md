# 등기사항전부증명서 PDF test fixtures

Fictional test inputs for the browser-side registry parser, which uses pdf.js. Every name, address, registration number, case number and amount is made up. Resident numbers are masked as `YYMMDD-*******`. The files are for local testing only. Do not publish them.

Regenerate everything with `python3 gen/build.py`. This needs fontTools (`pip install fonttools`), reportlab and `pdftoppm`.
Run the check with `NODE_PATH=<testenv>/node_modules node gen/verify.js .`, which uses pdfjs-dist@3.11.174 (legacy build). All fixtures currently pass.

## Files

| file | type | pages (body+summary) | what it tests |
|---|---|---|---|
| `apt_risky.pdf` | 집합건물 (아파트), 대지권 있음 | 4+1 | 보존(2011) → 매매(2015) → 증여(2020) → 매매(2024-09) on the same day as a 근저당. Cancelled: 압류 4 (by 5), 가압류 6 (by 7), 을구 근저당 1 (by 2), 근저당 3 and its 부기 3-1 (both by 6), 전세권 4 (by 5). Still valid: 건보공단 압류 9, 사해행위 가처분 10, 임의경매개시결정 11, 근저당 7 with 7-1 증액 and 7-2 개인 이전, 대부업체 근저당 8, 주택임차권 9. 을구 1 (struck) and 을구 9 run across page breaks. The 표제부 1동 표시번호 1 is struck by 2 (도로명주소). |
| `apt_risky_scan.pdf` | same content, image-only | 5 | `apt_risky.pdf` rendered at 150 dpi as JPEG (quality 82), one image per A4 page, no text layer. `getTextContent` returns 0 items. |
| `villa_trust.pdf` | 집합건물 다세대/근생 | 1+1 | 소유권보존 (2026-01) plus 신탁 in the same 순위번호 2 (two sub-rows, "소유권이전"/수탁자 and "신탁"/신탁원부 제2026-45호). The unit's 용도 is 제2종근린생활시설(사무소), i.e. a 근생빌라. The 대지권 sections are absent. 을구 shows a single "기록사항 없음" row. |
| `house_clean.pdf` | 건물 (단독주택) | 1+1 | 보존 → 소유권이전청구권가등기 (cancelled by 3 "2번가등기말소") → 매매. 을구 근저당 1 is cancelled by 2. Nothing valid besides ownership, so `expected_flags` is `[]`. |
| `land_share.pdf` | 토지 (공유) | 2+1 | 협의분할 상속 to 3 공유자 (1/2, 1/4, 1/4). 2-1 등기명의인표시변경 strikes only the old address line inside entry 2. 3 "2번김가상지분가압류" is valid. 4 "2번김다솜지분전부이전" is a 매매. 5 김나래지분압류 is cancelled by 6. 을구 has a 근저당 (공동담보목록) plus a 지상권, both valid. The rank and 표시번호 cells hold "1" / "(전 3)". |
| `set_land.pdf` + `set_bldg.pdf` | 토지 + 건물 on the same lot (미래동 45) | 1+1 each | The land stays with 박가상 (since 2010). The land carries a valid 가압류 by 최가상 (2025-01-20). The building's 보존 (2016, 박가상) is followed by a 증여 of the building alone to 박가상둘 (2025-03-14), then a 사해행위취소 가처분 by 최가상 (2025-08-11). Both 근저당 use 공동담보목록 제2012-77호, and the building's is 추가설정계약 2016. |
| `owner_a1.pdf` + `owner_a2.pdf` | two 집합건물 units | 2+1 each | The same previous owner 정가상 650505-******* transfers both units to 정가상아 920303-******* with the same receipt date, 2025-06-10. a1: 증여, after a valid 국세 압류 (권리자 국 / 처분청 가상세무서, 2025-05-14). a2: 매매 with 거래가액 금10,000,000원, plus a 근저당 to 정가상아 (2025-05-20, 금300,000,000원) that is still valid. |

Each `<name>.truth.json` holds:

- `document_type`, `property_kind`, `address`, `address_line`, `unique_no`, `viewed_at`, `registry_office`
- `has_text_layer` and `pages`
- `title_sections` (표제부 rows with cells and `cancelled`)
- `has_daejigwon`
- `current_owners` (name, role, id_no, share and share_fraction, address, rank)
- `entries`: every 갑구/을구 entry, with `section, rank, purpose, receipt_date (+_iso), receipt_no, cause, holder_text, cancelled, cancelled_by_rank`. Some entries also carry `partially_struck_lines`, `sub_rows` or `rank_display`.
- `summary_page` (the three summary tables)
- `entries_split_across_pages`
- `expected_flags`
- `notes`
- `cross_document` (set_* and owner_* only): group, related files, `expected_cross_flags`

`holder_text` contains logical lines. The PDF re-wraps long lines to fit the cell width, so compare after removing whitespace. Long tokens such as case numbers can break mid-token, for example `가압류결정(2023카단123` / `45)`.

## Layout conventions

These follow the 인터넷등기소 열람용 format.

- **Page:** A4 portrait, 595.28 × 841.89 pt. Font: WenQuanYi Zen Hei, embedded as a Type0/CIDFontType2 subset with Identity-H and a ToUnicode CMap.
- **Page 1 header:**
  - centered title `등기사항전부증명서(말소사항 포함) - 집합건물|건물|토지`
  - `[종류] 주소` on the left
  - `고유번호 xxxx-xxxx-xxxxxx` on the right
- **Pages 2+ header:** `[종류] 주소` only.
- **Every body page footer:** `열람일시 : 2026년11월10일 10시30분15초` on the left and `n/N` on the right, where N counts only the body pages.
- **Sections:**
  - each section is a bordered title bar, e.g. `【 갑 구 】 ( 소유권에 관한 사항 )`, followed by a column-header row with the exact header strings
  - when a section continues on a new page, the title bar and the header row are repeated
  - an entry split by a page break continues on the next page with blank 순위번호/등기목적/접수/등기원인 cells
- **Sub-rows:** a sub-row in the same rank (신탁) has a top rule that skips the 순위번호 column.
- **부기등기:** entries such as `7-1` and `7-2` print directly under their main entry, even when they were received later than the next main entry.
- **End of the last body page:**
  - `-- 이 하 여 백 --`
  - `관할등기소 …`
  - the two `* …` note lines
- **Summary page:**
  - title `주요 등기사항 요약 (참고용)`
  - a `[ 주 의 사 항 ]` box
  - the address line and 고유번호
  - the three tables, or `- 기록사항 없음` when a table is empty
  - a `[ 참 고 사 항 ]` block
  - the summary page has no `n/N` and no 열람일시

## How the red strike lines are drawn

Strike lines are vector **strokes**, not filled rectangles, and are colored pure red, RGB (1, 0, 0) via `RG`. Each struck cell line gets one horizontal segment:

```
q 0.6 w 1 0 0 RG  x1 y m x2 y l S  x1 y m x2 y l S ... Q
```

- y is the text baseline + 0.33 × fontsize. The body font size is 9 pt, so y = baseline + 2.97.
- x1 = text x − 0.5 and x2 = text x + text width + 0.5. The segment spans the text, not the whole cell.
- Every rendered line in every column of a cancelled entry is struck, including the 순위번호 cell and continuation lines after a page break.
- A partial strike marks a 변경 전 사항 line inside an entry that is still valid. The old 채권최고액 (after 근저당권변경), the old 근저당권자 lines (after 근저당권이전) and an old address (after 등기명의인표시변경) are struck. The rest of the entry is not. These lines are listed in `partially_struck_lines`.
- Grid lines are also strokes, black (`0 0 0 RG`, 0.5 w), drawn as multi-segment paths. Only the color tells grid lines and strike lines apart.

The verification script finds every red horizontal segment and matches it to text items. A segment matches an item when the line's y falls between the item's baseline and baseline + 0.8 × fontsize, and the segment covers the item's x-range.
- For every cancelled entry, the receipt-number item is struck.
- For every valid entry, it is not.
- Every `partially_struck_lines` entry has struck fragments.

## pdf.js 3.11.174 observations

- **Text items:**
  - Each cell line is one `Tj` and comes out as one item, e.g. `"2015년6월1일"`, `"제45678호"`, `"채권자 박소망 800808-*******"`. Hangul extracts correctly.
  - Single-character items are only genuinely one-character cells such as rank numbers.
  - pdf.js also inserts synthetic items: `""` with `hasEOL: true` when the baseline changes, and `" "` when two items share a baseline (e.g. between the address and 고유번호).
  - Content order is header, footer, then tables, so sort by y/x rather than relying on stream order.
- **Strike ops:** `getOperatorList()` shows each red line as `save`, `setLineWidth [0.6]`, `setStrokeRGBColor`, `constructPath`, `stroke`, …, `restore`. These are the raw args from apt_risky page 1:

```
setLineWidth (2)        [0.6]
setStrokeRGBColor (58)  Uint8ClampedArray [255, 0, 0]
constructPath (91)      [[13, 14], [49.8, 717.72, 56.2, 717.72], [49.8, 56.2, 717.72, 717.72]]
stroke (20)             null
```

  Color arrives as 0–255 integers, not 0–1. The `constructPath` args are `[ops (13=moveTo, 14=lineTo), coords, minMax=[minX, maxX, minY, maxY]]`. Coordinates are in PDF user space, because no `cm` is used. They line up directly with `item.transform[4]` / `item.transform[5]` from `getTextContent`.
