#!/usr/bin/env python3
"""
generate_roster.py
Generates a USMC Duty Music Roster PDF using exact coordinates
measured from the official May 2026 roster.

Usage:
    python3 generate_roster.py <json_input> <output_path>

json_input is a JSON string with:
{
  "year": 2026,
  "month_name": "June",
  "month_upper": "JUNE",
  "pub_date": "1 May 26",
  "left_rows": [["1","SGT CAMPA"], ["*2","SGT ROSIE"], ...],
  "right_rows": [["17","GYSGT MCCREARY"], ...],
  "co_name": "N. D. MORRIS"
}
"""

import sys
import json
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

# ── Layout constants — measured from official May 2026 roster ────────────────
PAGE_W, PAGE_H   = 612, 792

FONT_HELV_BOLD   = "Helvetica-Bold"
FONT_HELV        = "Helvetica"
FONT_TIMES       = "Times-Roman"
FONT_TIMES_BOLD  = "Times-Bold"
FONT_COURIER     = "Courier"

SIZE_LH_BOLD     = 8.4    # "UNITED STATES MARINE CORPS"
SIZE_LH_LINE2    = 5.6    # "THE UNITED STATES MARINE DRUM & BUGLE CORPS"
SIZE_LH_LINE345  = 4.9    # MARINE BARRACKS / 8TH & I / WASHINGTON
SIZE_REPLY_LABEL = 4.2    # "IN REPLY REFER TO:"
SIZE_BODY        = 8.4    # All memo / roster text

# Y positions (ReportLab: y=0 at bottom = PAGE_H - measured_top)
Y_LH1            = 735.6  # "UNITED STATES MARINE CORPS"
Y_LH2            = 725.7  # "THE UNITED STATES..."
Y_LH3            = 718.5  # "MARINE BARRACKS"
Y_LH4            = 711.4  # "8TH & I STREETS SE"
Y_LH5            = 705.0  # "WASHINGTON, DC..."
Y_REPLY1         = 695.7  # "IN REPLY REFER TO:"
Y_REPLY2         = 688.3  # "1601.2"
Y_REPLY3         = 677.7  # "D&B"
Y_REPLY4         = 666.9  # publication date
Y_MEMORANDUM     = 645.4
Y_FROM           = 623.8
Y_TO             = 613.0
Y_SUBJ           = 591.4
Y_PARA           = 569.7
Y_DUTY_MUSIC     = 548.5
Y_RULE           = 544.0  # horizontal rule
Y_HEADERS        = 526.9  # DATE / NAME header baseline
Y_MONTH          = 505.3  # month name row
Y_ROW1           = 483.7  # first roster row baseline
ROW_GAP          = 21.6   # exact gap between rows
Y_FOOTNOTE       = 138.7
Y_SIGNATURE      = 75.1

# X positions
REPLY_RIGHT      = 505.0  # reply block right edge
LEFT_DATE_RIGHT  = 83.0   # left column dates right-align here
LEFT_NAME_X      = 88.4   # left column names left-start here
RIGHT_DATE_RIGHT = 354.0  # right column dates right-align here
RIGHT_NAME_X     = 358.3  # right column names left-start here
MEMO_X           = 54.7   # left margin for memo text
RULE_RIGHT       = 557.3  # right end of horizontal rule (PAGE_W - MEMO_X)


def build_roster(data, output_path):
    year        = data["year"]
    month_name  = data["month_name"]
    month_upper = data["month_upper"]
    pub_date    = data["pub_date"]
    left_rows   = data["left_rows"]
    right_rows  = data["right_rows"]
    co_name     = data["co_name"]

    c = canvas.Canvas(output_path, pagesize=letter)

    # ── Drawing helpers ──────────────────────────────────────────────────────
    def dt(text, x, y, font, size):
        c.setFont(font, size)
        c.drawString(x, y, text)

    def dtr(text, right_x, y, font, size):
        c.setFont(font, size)
        w = c.stringWidth(text, font, size)
        c.drawString(right_x - w, y, text)

    def dtc(text, y, font, size):
        c.setFont(font, size)
        w = c.stringWidth(text, font, size)
        c.drawString((PAGE_W - w) / 2, y, text)

    # ── Letterhead ───────────────────────────────────────────────────────────
    dtc("UNITED STATES MARINE CORPS",                     Y_LH1, FONT_HELV_BOLD,  SIZE_LH_BOLD)
    dtc("THE UNITED STATES MARINE DRUM & BUGLE CORPS",    Y_LH2, FONT_HELV,       SIZE_LH_LINE2)
    dtc("MARINE BARRACKS",                                 Y_LH3, FONT_HELV,       SIZE_LH_LINE345)
    dtc("8TH & I STREETS SE",                              Y_LH4, FONT_HELV,       SIZE_LH_LINE345)
    dtc("WASHINGTON, DC 20390-5000",                       Y_LH5, FONT_HELV,       SIZE_LH_LINE345)

    # ── Reply block (right-aligned) ──────────────────────────────────────────
    dtr("IN REPLY REFER TO:", REPLY_RIGHT, Y_REPLY1, FONT_COURIER, SIZE_REPLY_LABEL)
    dtr("1601.2",             REPLY_RIGHT, Y_REPLY2, FONT_TIMES,   SIZE_BODY)
    dtr("D&B",               REPLY_RIGHT, Y_REPLY3, FONT_TIMES,   SIZE_BODY)
    dtr(pub_date,            REPLY_RIGHT, Y_REPLY4, FONT_TIMES,   SIZE_BODY)

    # ── Memo body ────────────────────────────────────────────────────────────
    dt("MEMORANDUM", MEMO_X, Y_MEMORANDUM, FONT_TIMES_BOLD, SIZE_BODY)
    dt("From:  Commanding Officer, Drum & Bugle Corps Company", MEMO_X, Y_FROM, FONT_TIMES, SIZE_BODY)
    dt("To:      Duty Musics, Drum & Bugle Corps Company",      MEMO_X, Y_TO,   FONT_TIMES, SIZE_BODY)
    dt(f"Subj:    DUTY MUSIC ROSTER FOR THE MONTH OF {month_upper}, {year}.",
       MEMO_X, Y_SUBJ, FONT_TIMES, SIZE_BODY)
    dt(f"1.  The following comprises the Duty Music assignments for the month of {month_name}, {year}.",
       MEMO_X, Y_PARA, FONT_TIMES, SIZE_BODY)

    # ── DUTY MUSIC title + horizontal rule ───────────────────────────────────
    dt("DUTY MUSIC", MEMO_X, Y_DUTY_MUSIC, FONT_TIMES, SIZE_BODY)
    c.setLineWidth(0.5)
    c.line(MEMO_X, Y_RULE, RULE_RIGHT, Y_RULE)

    # ── DATE / NAME column headers with underlines ───────────────────────────
    c.setFont(FONT_TIMES, SIZE_BODY)
    for text, is_right_aligned, rx, lx in [
        ("DATE", True,  LEFT_DATE_RIGHT,  None),
        ("NAME", False, None,             LEFT_NAME_X),
        ("DATE", True,  RIGHT_DATE_RIGHT, None),
        ("NAME", False, None,             RIGHT_NAME_X),
    ]:
        w = c.stringWidth(text, FONT_TIMES, SIZE_BODY)
        x = (rx - w) if is_right_aligned else lx
        c.drawString(x, Y_HEADERS, text)
        c.setLineWidth(0.4)
        c.line(x, Y_HEADERS - 1, x + w, Y_HEADERS - 1)

    # ── Month label ──────────────────────────────────────────────────────────
    dtr(month_upper, LEFT_DATE_RIGHT, Y_MONTH, FONT_TIMES, SIZE_BODY)

    # ── Roster rows — date and name always drawn separately ──────────────────
    row_count = max(len(left_rows), len(right_rows))
    for i in range(row_count):
        row_y = Y_ROW1 - i * ROW_GAP

        if i < len(left_rows):
            day_str, name_str = left_rows[i][0], left_rows[i][1]
            dtr(day_str, LEFT_DATE_RIGHT, row_y, FONT_TIMES, SIZE_BODY)
            if name_str:
                dt(name_str, LEFT_NAME_X, row_y, FONT_TIMES, SIZE_BODY)

        if i < len(right_rows):
            day_str, name_str = right_rows[i][0], right_rows[i][1]
            dtr(day_str, RIGHT_DATE_RIGHT, row_y, FONT_TIMES, SIZE_BODY)
            if name_str:
                dt(name_str, RIGHT_NAME_X, row_y, FONT_TIMES, SIZE_BODY)

    # ── Footnote ─────────────────────────────────────────────────────────────
    dt("* denotes weekend day", MEMO_X, Y_FOOTNOTE, FONT_TIMES, SIZE_BODY)

    # ── Signature (centered) ─────────────────────────────────────────────────
    dtc(co_name, Y_SIGNATURE, FONT_TIMES, SIZE_BODY)

    c.save()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: generate_roster.py <json_input> <output_path>", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(sys.argv[1])
        build_roster(data, sys.argv[2])
        print("OK")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
