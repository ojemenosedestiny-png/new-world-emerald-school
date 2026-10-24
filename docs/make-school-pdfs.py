"""Builds docs/ACADEMIC-CALENDAR-2026-2027.pdf and docs/PROSPECTUS.pdf for New World Emerald Private School.

Run from anywhere: python docs/make-school-pdfs.py  (needs: pip install reportlab pillow)

Facts come from the school's own website text. Calendar: public holidays are fixed dates; Islamic holidays
depend on moon sighting; term dates are proposed (no official FCT 2026/2027 circular was published online
as of 24 October 2026) and must be confirmed by the school before release.
"""
import calendar
import datetime as dt
from io import BytesIO
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (BaseDocTemplate, Frame, Image, KeepTogether, NextPageTemplate, PageBreak, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "artifacts" / "new-world-emerald" / "public"
EMERALD = colors.HexColor("#176345")
EMERALD_SOFT = colors.HexColor("#e3efe8")
INK = colors.HexColor("#10232c")
MUTED = colors.HexColor("#5c6b70")
GOLD = colors.HexColor("#c8931c")
GOLD_SOFT = colors.HexColor("#f7eed8")
RED_SOFT = colors.HexColor("#f6dfdc")
RED = colors.HexColor("#a8382c")
BLUE_SOFT = colors.HexColor("#dfe8f6")
IVORY = colors.HexColor("#faf7f0")
LINE = colors.HexColor("#ddd6c6")
WHITE = colors.white
W, H = A4
MARGIN = 16 * mm
CW = W - 2 * MARGIN
SCHOOL = "New World Emerald Private School"
ADDRESS = "Emerald Building, New World Crescent, Oyigene Audu Avenue, F01 Kubwa, Abuja"
PHONE = "+234 813 603 7074"
EMAIL = "info@newworldemeraldprivateschool.com"
SITE = "newworldemeraldprivateschool.com"

base = dict(fontName="Helvetica", textColor=INK, leading=14.5, fontSize=10)
S = {
    "body": ParagraphStyle("body", **base, spaceAfter=6),
    "lead": ParagraphStyle("lead", **{**base, "fontSize": 11.5, "leading": 17}, spaceAfter=8),
    "small": ParagraphStyle("small", **{**base, "fontSize": 8.4, "leading": 11.5, "textColor": MUTED}),
    "h1": ParagraphStyle("h1", fontName="Times-Bold", fontSize=22, leading=26, textColor=INK, spaceBefore=2, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=EMERALD, spaceBefore=10, spaceAfter=4),
    "kicker": ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=EMERALD, spaceBefore=4, spaceAfter=2),
    "bullet": ParagraphStyle("bullet", **base, leftIndent=12, bulletIndent=2, spaceAfter=3),
    "cell": ParagraphStyle("cell", **{**base, "fontSize": 9, "leading": 12}),
    "cellb": ParagraphStyle("cellb", **{**base, "fontName": "Helvetica-Bold", "fontSize": 9, "leading": 12}),
    "head": ParagraphStyle("head", **{**base, "fontName": "Helvetica-Bold", "fontSize": 8.8, "leading": 11, "textColor": WHITE}),
    "callout": ParagraphStyle("callout", **{**base, "fontSize": 9.4, "leading": 13.5}),
    "quote": ParagraphStyle("quote", **{**base, "fontName": "Times-Italic", "fontSize": 12, "leading": 17}),
}


def P(text, style="body"):
    return Paragraph(text, S[style])


def bullets(items):
    return [Paragraph(t, S["bullet"], bulletText="•") for t in items]


def callout(text, tone="gold"):
    bg, edge = {"gold": (GOLD_SOFT, GOLD), "emerald": (EMERALD_SOFT, EMERALD), "red": (RED_SOFT, RED)}[tone]
    t = Table([[Paragraph(text, S["callout"])]], colWidths=[CW])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                           ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    return t


def table(rows, widths, zebra=True, extra=()):
    data = [[Paragraph(str(c), S["head"] if r == 0 else (S["cellb"] if i == 0 else S["cell"])) for i, c in enumerate(row)] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
          ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
          ("BACKGROUND", (0, 0), (-1, 0), EMERALD)]
    if zebra:
        st += [("BACKGROUND", (0, r), (-1, r), IVORY) for r in range(2, len(rows), 2)]
    t.setStyle(TableStyle(st + list(extra)))
    return t


def photo(name, width, height=None):
    """A photo from the website's public folder, converted to JPEG (reportlab cannot read WebP)."""
    im = PILImage.open(PUBLIC / name).convert("RGB")
    if height is None:
        height = width * im.height / im.width
    else:  # crop to the box so photos never stretch
        target = width / height
        if im.width / im.height > target:
            nw = int(im.height * target)
            im = im.crop(((im.width - nw) // 2, 0, (im.width + nw) // 2, im.height))
        else:
            nh = int(im.width / target)
            im = im.crop((0, (im.height - nh) // 2, im.width, (im.height + nh) // 2))
    buf = BytesIO()
    im.save(buf, "JPEG", quality=88)
    buf.seek(0)
    return Image(buf, width=width, height=height)


def page_decor(header):
    def draw(c, doc):
        c.saveState()
        c.setFillColor(IVORY); c.rect(0, H - 12 * mm, W, 12 * mm, stroke=0, fill=1)
        c.setFillColor(EMERALD); c.rect(0, H - 12 * mm, W, 1.2, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 7.5); c.drawString(MARGIN, H - 7.8 * mm, header)
        c.setFont("Helvetica", 7.5); c.setFillColor(MUTED)
        c.drawRightString(W - MARGIN, H - 7.8 * mm, SITE)
        c.drawRightString(W - MARGIN, 9 * mm, f"Page {doc.page}")
        c.drawString(MARGIN, 9 * mm, f"{PHONE}  ·  {EMAIL}")
        c.restoreState()
    return draw


def cover(title_lines, subtitle, details, image=None):
    def draw(c, doc):
        c.saveState()
        c.setFillColor(INK); c.rect(0, 0, W, H, stroke=0, fill=1)
        if image:
            im = PILImage.open(PUBLIC / image).convert("RGB")
            box_h = H * 0.42
            target = W / box_h
            nh = int(im.width / target)
            im = im.crop((0, max(0, (im.height - nh) // 2), im.width, min(im.height, (im.height + nh) // 2)))
            buf = BytesIO(); im.save(buf, "JPEG", quality=85); buf.seek(0)
            c.drawImage(ImageReader(buf), 0, H - box_h, W, box_h)
            c.setFillColor(colors.Color(0.06, 0.14, 0.17, alpha=0.45)); c.rect(0, H - box_h, W, box_h, stroke=0, fill=1)
        c.setFillColor(EMERALD); c.rect(0, H * 0.36, W, 6, stroke=0, fill=1)
        c.setFillColor(GOLD); c.rect(0, H * 0.36 - 3, W * 0.42, 3, stroke=0, fill=1)
        logo = PILImage.open(PUBLIC / "logo.jpg").convert("RGB"); lb = BytesIO(); logo.save(lb, "JPEG", quality=92); lb.seek(0)
        c.drawImage(ImageReader(lb), MARGIN, H * 0.36 + 70 * mm, 19 * mm, 19 * mm * logo.height / logo.width)
        c.setFillColor(GOLD); c.setFont("Helvetica-Bold", 10)
        c.drawString(MARGIN, H * 0.36 + 58 * mm, SCHOOL.upper())
        c.setFillColor(WHITE); c.setFont("Times-Bold", 36)
        for i, line in enumerate(title_lines):
            c.drawString(MARGIN, H * 0.36 + (42 - 14 * i) * mm, line)
        c.setFont("Helvetica", 12.5); c.setFillColor(colors.HexColor("#cfd8d4"))
        c.drawString(MARGIN, H * 0.36 + (32 - 14 * (len(title_lines) - 1)) * mm, subtitle)
        c.setFont("Helvetica", 10); c.setFillColor(WHITE)
        y = H * 0.36 - 26
        for line in details:
            c.drawString(MARGIN, y, line); y -= 16
        c.restoreState()
    return draw


def build(out, title, story, cover_fn, header):
    doc = BaseDocTemplate(str(HERE / out), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=18 * mm, bottomMargin=16 * mm,
                          title=title, author=SCHOOL, subject=title)
    frame = Frame(MARGIN, 16 * mm, CW, H - 34 * mm, id="body")
    doc.addPageTemplates([PageTemplate(id="cover", frames=[frame], onPage=cover_fn),
                          PageTemplate(id="content", frames=[frame], onPage=page_decor(header))])
    doc.build([NextPageTemplate("content"), PageBreak(), *story])
    print("wrote", out)


# =====================================================================================
# Academic calendar 2026/2027
# =====================================================================================
D = dt.date
# kind: term (term dates), break (mid-term / holidays), holiday (public holiday), exam-free notes
# status: "Proposed" (school to confirm), "Fixed" (public holiday on a fixed date), "Moon" (subject to FG declaration)
EVENTS = [
    ("First term", D(2026, 9, 13), None, "Boarders arrive", "term", "Proposed"),
    ("First term", D(2026, 9, 14), None, "First term begins", "term", "Proposed"),
    ("First term", D(2026, 10, 1), None, "Independence Day (public holiday)", "holiday", "Fixed"),
    ("First term", D(2026, 10, 29), D(2026, 10, 30), "Mid-term break", "break", "Proposed"),
    ("First term", D(2026, 12, 18), None, "First term ends", "term", "Proposed"),
    ("Christmas holiday", D(2026, 12, 25), None, "Christmas Day (public holiday)", "holiday", "Fixed"),
    ("Christmas holiday", D(2026, 12, 26), None, "Boxing Day (public holiday)", "holiday", "Fixed"),
    ("Christmas holiday", D(2027, 1, 1), None, "New Year's Day (public holiday)", "holiday", "Fixed"),
    ("Second term", D(2027, 1, 11), None, "Second term begins", "term", "Proposed"),
    ("Second term", D(2027, 2, 18), D(2027, 2, 19), "Mid-term break", "break", "Proposed"),
    ("Second term", D(2027, 3, 9), D(2027, 3, 10), "Eid-el-Fitr (public holiday, expected)", "holiday", "Moon"),
    ("Second term", D(2027, 3, 25), None, "Second term ends (before Easter)", "term", "Proposed"),
    ("Easter holiday", D(2027, 3, 26), None, "Good Friday (public holiday)", "holiday", "Fixed"),
    ("Easter holiday", D(2027, 3, 29), None, "Easter Monday (public holiday)", "holiday", "Fixed"),
    ("Third term", D(2027, 4, 19), None, "Third term begins", "term", "Proposed"),
    ("Third term", D(2027, 5, 1), None, "Workers' Day (public holiday)", "holiday", "Fixed"),
    ("Third term", D(2027, 5, 16), D(2027, 5, 17), "Eid-el-Kabir (public holiday, expected)", "holiday", "Moon"),
    ("Third term", D(2027, 6, 10), D(2027, 6, 11), "Mid-term break", "break", "Proposed"),
    ("Third term", D(2027, 6, 12), None, "Democracy Day (public holiday)", "holiday", "Fixed"),
    ("Third term", D(2027, 7, 23), None, "Third term and session end", "term", "Proposed"),
    ("Long vacation", D(2027, 8, 14), None, "Id-el-Maulud (public holiday, expected)", "holiday", "Moon"),
    ("Long vacation", D(2027, 9, 13), None, "2027/2028 session begins", "term", "Proposed"),
]
TERMS = [(D(2026, 9, 14), D(2026, 12, 18)), (D(2027, 1, 11), D(2027, 3, 25)), (D(2027, 4, 19), D(2027, 7, 23))]
STATUS = {"Proposed": "Proposed: school to confirm", "Fixed": "Fixed public holiday", "Moon": "Expected: date set by the Federal Government"}


def fmt(a, b=None):
    if b is None:
        return a.strftime("%a %d %b %Y").replace(" 0", " ")
    if a.month == b.month:
        return f"{a.strftime('%a %d').replace(' 0', ' ')} – {b.strftime('%a %d %b %Y').replace(' 0', ' ')}"
    return f"{fmt(a)} – {fmt(b)}"


def weeks(a, b):
    return round(((b - a).days + 3) / 7)


def day_kind(day):
    for _, a, b, _, kind, _ in EVENTS:
        if a <= day <= (b or a) and kind in ("holiday", "break"):
            return kind
    in_term = any(a <= day <= b for a, b in TERMS)
    if not in_term:
        return "vacation"
    return "weekend" if day.weekday() >= 5 else "term"


FILL = {"term": EMERALD_SOFT, "holiday": RED_SOFT, "break": GOLD_SOFT, "vacation": BLUE_SOFT, "weekend": WHITE}


def month_grid(year, month, width):
    cal = calendar.Calendar(firstweekday=0)
    rows = [[calendar.month_name[month] + f" {year}"] + [""] * 6, list("MTWTFSS")]
    cells = []
    for week in cal.monthdatescalendar(year, month):
        rows.append([str(d.day) if d.month == month else "" for d in week])
        cells.append(week)
    cw = width / 7
    t = Table(rows, colWidths=[cw] * 7, rowHeights=[5.2 * mm] + [4.4 * mm] * (len(rows) - 1))
    st = [("SPAN", (0, 0), (-1, 0)), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8), ("TEXTCOLOR", (0, 0), (-1, 0), EMERALD),
          ("FONT", (0, 1), (-1, 1), "Helvetica-Bold", 6.5), ("TEXTCOLOR", (0, 1), (-1, 1), MUTED),
          ("FONT", (0, 2), (-1, -1), "Helvetica", 7), ("ALIGN", (0, 1), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
          ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0), ("LEFTPADDING", (0, 0), (-1, -1), 1), ("RIGHTPADDING", (0, 0), (-1, -1), 1)]
    for r, week in enumerate(cells, start=2):
        for c, d in enumerate(week):
            if d.month != month:
                continue
            st.append(("BACKGROUND", (c, r), (c, r), FILL[day_kind(d)]))
            if day_kind(d) in ("holiday", "break"):
                st.append(("FONT", (c, r), (c, r), "Helvetica-Bold", 7))
            if day_kind(d) == "weekend":
                st.append(("TEXTCOLOR", (c, r), (c, r), MUTED))
    t.setStyle(TableStyle(st))
    return t


def calendar_story():
    story = [P("2026/2027 ACADEMIC SESSION", "kicker"), P("Term dates and holidays", "h1"),
             callout("<b>Draft for the school to confirm.</b> Public holidays below are fixed dates. Eid and Id-el-Maulud dates depend on moon "
                     "sighting and are declared by the Federal Government. Term dates follow the usual FCT pattern and the dates most widely "
                     "reported for this session; no official FCT Education Secretariat circular for 2026/2027 had been published online at the "
                     "time of writing (24 October 2026). The school office should confirm or adjust them before sharing with families.", "gold"),
             Spacer(1, 8)]
    terms = [("First term", TERMS[0]), ("Second term", TERMS[1]), ("Third term", TERMS[2])]
    story.append(table([["Term", "Begins", "Ends", "Length"]] + [[n, fmt(a), fmt(b), f"About {weeks(a, b)} weeks"] for n, (a, b) in terms],
                       [32 * mm, 50 * mm, 50 * mm, CW - 132 * mm]))
    story.append(Spacer(1, 8))
    rows = [["Date", "Event", "Status"]]
    extra = []
    section = None
    for group, a, b, label, kind, status in EVENTS:
        if group != section:
            section = group
            rows.append([group.upper(), "", ""])
            extra += [("SPAN", (0, len(rows) - 1), (-1, len(rows) - 1)), ("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), EMERALD_SOFT)]
        rows.append([fmt(a, b), label, STATUS[status]])
        if kind == "holiday":
            extra.append(("TEXTCOLOR", (1, len(rows) - 1), (1, len(rows) - 1), RED))
    story.append(table(rows, [48 * mm, CW - 48 * mm - 52 * mm, 52 * mm], zebra=False, extra=extra))
    story += [Spacer(1, 6),
              P("External examinations (WAEC, NECO and BECE, and Cambridge Checkpoint and IGCSE) run to the timetables published by each "
                "examination body. Candidates and parents are told the dates as soon as they are released. School events such as sports day, "
                "PTA meetings, open days and Cultural Day are announced on the website and in the Student Portal.", "small"),
              PageBreak(), P("AT A GLANCE", "kicker"), P("Month by month", "h1")]
    key = Table([["", "School day", "", "Mid-term break", "", "Public holiday", "", "Holiday / vacation"]],
                colWidths=[5 * mm, 30 * mm, 5 * mm, 32 * mm, 5 * mm, 32 * mm, 5 * mm, 40 * mm], rowHeights=[5 * mm])
    key.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), EMERALD_SOFT), ("BACKGROUND", (2, 0), (2, 0), GOLD_SOFT), ("BACKGROUND", (4, 0), (4, 0), RED_SOFT),
                             ("BACKGROUND", (6, 0), (6, 0), BLUE_SOFT), ("FONT", (0, 0), (-1, -1), "Helvetica", 8), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                             ("BOX", (0, 0), (0, 0), 0.4, LINE), ("BOX", (2, 0), (2, 0), 0.4, LINE), ("BOX", (4, 0), (4, 0), 0.4, LINE), ("BOX", (6, 0), (6, 0), 0.4, LINE)]))
    story += [key, Spacer(1, 6)]
    months = [(2026, m) for m in range(9, 13)] + [(2027, m) for m in range(1, 9)]
    gw = (CW - 8 * mm) / 3
    grid_rows = [[month_grid(y, m, gw) for y, m in months[i:i + 3]] for i in range(0, len(months), 3)]
    grid = Table(grid_rows, colWidths=[gw + 4 * mm] * 3)
    grid.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm)]))
    story += [grid, P(f"Questions about the calendar: {EMAIL} or {PHONE}.", "small")]
    return story


build("ACADEMIC-CALENDAR-2026-2027.pdf", f"{SCHOOL}: Academic Calendar 2026/2027", calendar_story(),
      cover(["Academic Calendar"], "2026/2027 session: term dates and holidays",
            [ADDRESS, f"{PHONE}  ·  {EMAIL}", "Draft for the school office to confirm (24 October 2026)"], image="campus-building-background.webp"),
      "NEW WORLD EMERALD · ACADEMIC CALENDAR 2026/2027")


# =====================================================================================
# Prospectus
# =====================================================================================
def prospectus_story():
    s = []
    # Welcome
    director = photo("mrs-folakemi-olasanya.jpeg", 52 * mm, 52 * mm)
    welcome = [P("WELCOME", "kicker"), P("A message from our Director", "h1"),
               P("Dear Parents,", "body"),
               P(f"It is a pleasure to welcome you to {SCHOOL}, situated in the heart of Kubwa, Abuja.", "body"),
               P("Choosing a school for your child is an important decision. You want to feel confident that they will be cared for, "
                 "encouraged, and given every opportunity to succeed. As Director, I take that responsibility seriously, and I am grateful "
                 "that you are considering our school.", "body"),
               P("Thank you for considering New World Emerald. I look forward to getting to know you and working together to help your "
                 "child reach their full potential.", "body"),
               P("<b>Mrs. Folakemi Olasanya</b><br/>Director", "body")]
    t = Table([[director, welcome]], colWidths=[58 * mm, CW - 58 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 6 * mm)]))
    s += [t, Spacer(1, 6),
          callout("<b>Five years of learning together.</b> New World Emerald has completed five years of nurturing young learners in an "
                  "environment where academic rigour meets character development.", "emerald")]
    # Vision, mission, values
    s += [P("WHO WE ARE", "kicker"), P("Vision, mission and values", "h1"),
          P("Our vision", "h2"),
          P("To nurture knowledgeable, confident, and independent learners. We want our children to think creatively, ask questions, show "
            "compassion for others, and develop the courage to make thoughtful decisions.", "lead"),
          P("Our mission", "h2"),
          P("To provide a rigorous academic programme through purposeful teaching, helping every student take responsibility for their "
            "learning and develop skills they can carry into the future.", "lead"),
          P("Our six core values", "h2")]
    values = [("Respect", "for every person in our community"), ("Tolerance", "of different views, faiths and backgrounds"),
              ("Inclusion", "so every child belongs and takes part"), ("Child-centredness", "learning shaped around each child"),
              ("Integrity", "honesty in work and in character"), ("Excellence", "pride in doing our best")]
    vt = Table([[Paragraph(f"<b>{a}</b><br/><font size=8.4 color='#5c6b70'>{b}</font>", S["cell"]) for a, b in values[i:i + 3]] for i in (0, 3)],
               colWidths=[CW / 3] * 3)
    vt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), IVORY), ("BOX", (0, 0), (-1, -1), 0.5, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (-1, -1), 8)]))
    s += [vt, P("These values shape how we teach, support our students, and relate to one another. We want every child to feel valued, to "
                "respect others, and to take pride in doing their best.", "body"), PageBreak()]
    # Curriculum
    s += [P("LEARNING", "kicker"), P("Our curriculum", "h1"),
          P("We offer <b>Cambridge and Nigerian curricula</b>, beginning with the Early Years Foundation Stage (EYFS) and continuing through to "
            "GCSE level at age 16, so pupils build strong foundations with both a national and an international outlook.", "lead"),
          table([["Stage", "Ages", "Focus", "Examinations"],
                 ["Creche and Nursery", "6 months – 5 years", "Play, sensory exploration and early language; social confidence and growing independence; first steps in literacy and numeracy.", "Early Years Foundation Stage (EYFS)"],
                 ["Primary School", "5 – 11 years", "Reading, writing, mathematics and curiosity about the world, with an emphasis on critical thinking, literacy and numeracy.", "Cambridge Primary"],
                 ["Junior Secondary", "11 – 14 years", "Independent study, scientific inquiry and broad subject exploration as students discover their strengths.", "Cambridge Checkpoint (Year 8); BECE (ERC / NECO) and IGCSE in JSS 3"],
                 ["Senior Secondary", "14 – 17 years", "Deeper subject knowledge in science, arts and commercial tracks, with preparation for university and beyond.", "SSCE (WAEC and NECO)"]],
                [33 * mm, 26 * mm, CW - 33 * mm - 26 * mm - 46 * mm, 46 * mm]),
          P("Ages 16 to 18: three internationally recognised pathways", "h2"),
          *bullets(["<b>English A Level</b>", "<b>International Baccalaureate (IB) Diploma</b>", "<b>BTEC Vocational Courses</b>"]),
          P("Contact admissions for current subject combinations and entry guidance.", "small")]
    pics = Table([[photo(n, (CW - 8 * mm) / 3, 44 * mm) for n in ("creche.jpg", "primary.jpg", "secondary.jpg")]], colWidths=[(CW - 8 * mm) / 3 + 4 * mm] * 3)
    pics.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm)]))
    s += [Spacer(1, 6), pics, PageBreak()]
    # Why us / facilities
    s += [P("THE EMERALD ADVANTAGE", "kicker"), P("Why families choose us", "h1"),
          *bullets(["<b>Experienced, qualified teachers</b> who give individual attention and help students build on their strengths and work through challenges.",
                    "<b>Cambridge and Nigerian curricula</b> combined for strong academic foundations with a national and international outlook.",
                    "<b>Modern facilities</b>: science laboratories and integrated technology that prepare students for a digital future.",
                    "<b>Character as well as grades</b>: an emphasis on empathy, leadership and integrity beyond academics.",
                    "<b>Personal attention</b> and tailored learning for every student.",
                    "<b>An inclusive, caring community</b> that welcomes children from across Nigeria."]),
          P("Boarding", "h2"),
          P("We offer boarding for students from Junior Secondary upwards, providing a structured, safe and nurturing environment.", "body"),
          P("Partnership with parents", "h2"),
          P("A strong partnership between home and school makes a meaningful difference. Your understanding of your child, your involvement and "
            "your support are essential parts of their education. Parents follow school news, events and live updates on our website, and "
            "students use the Student Portal for results, report cards, assignments, attendance and messages to their class teacher.", "body")]
    fac = Table([[photo(n, (CW - 8 * mm) / 3, 40 * mm) for n in ("science-lab.jpg", "library.jpg", "sports.jpg")]], colWidths=[(CW - 8 * mm) / 3 + 4 * mm] * 3)
    fac.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm)]))
    s += [Spacer(1, 4), fac, PageBreak()]
    # Admissions and fees
    s += [P("JOINING US", "kicker"), P("Admissions", "h1"),
          P("How to apply", "h2"),
          table([["Step", "What happens"],
                 ["1. Apply", f"Complete the online application at {SITE} (Admissions), or visit the school office."],
                 ["2. Assessment", "Your child sits an entrance examination appropriate to their age and class."],
                 ["3. Interview", "We meet the student and parents to get to know your family."],
                 ["4. Offer", "Successful candidates receive an offer letter within two weeks."]],
                [32 * mm, CW - 32 * mm]),
          P("Scholarships", "h2"),
          P("Merit-based scholarships are available for exceptional students entering Senior Secondary. Financial aid is available on a limited, "
            "case-by-case basis.", "body"),
          P("Fees", "h2"),
          table([["Item", "Indicative amount", "Notes"],
                 ["Registration and assessment", "NGN 20,000", "One-time, non-refundable"],
                 ["Day student tuition", "From NGN 1,250,000", "Per year; varies by class"],
                 ["Boarding", "Up to NGN 2,000,000", "Per year"]],
                [55 * mm, 45 * mm, CW - 100 * mm]),
          P("Amounts are indicative and vary by class. Ask the admissions office for the current fee schedule for your child's class. "
            "Fees can be paid by bank transfer; the school's bank accounts and a payment form are on the School Payments page of our website.", "small"),
          Spacer(1, 10),
          callout(f"<b>Visit us</b><br/>{ADDRESS}<br/>Phone: {PHONE}<br/>Email: {EMAIL}<br/>Website: {SITE}<br/><br/>"
                  "We welcome families to visit, meet our teachers and see the school at work. Call or email to book a visit.", "emerald")]
    return s


build("PROSPECTUS.pdf", f"{SCHOOL}: Prospectus", prospectus_story(),
      cover(["Prospectus"], "Cambridge and Nigerian curricula, from Creche to Senior Secondary",
            [ADDRESS, f"{PHONE}  ·  {EMAIL}", SITE], image="campus-building-background.webp"),
      "NEW WORLD EMERALD · PROSPECTUS")
