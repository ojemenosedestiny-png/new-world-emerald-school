"""Builds mixed-paper.pdf, a made-up SS3 English and Mathematics paper used to test the PDF importer.

It reproduces the layouts that broke the old importer: a passage before Question 1, a running
page header, page numbers, options at the foot of a page, inline options, and two drawn diagrams
(a triangle for Question 18, a trapezium for Question 20) with text labels.

    python make-mixed-paper.py   (needs reportlab; writes mixed-paper.pdf beside this file)
"""
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

W, H = A4
LEFT, RIGHT = 56, W - 56
HEADER = "SS3 ENGLISH LANGUAGE AND MATHEMATICS"
out = Path(__file__).with_name("mixed-paper.pdf")
c = canvas.Canvas(str(out), pagesize=A4)
page = 0
y = 0.0


def new_page():
    global page, y
    if page:
        c.showPage()
    page += 1
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(W / 2, H - 36, HEADER)
    c.setLineWidth(0.6)
    c.line(LEFT, H - 42, RIGHT, H - 42)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W / 2, 28, f"Page {page} of 3")
    y = H - 70


def line(text, size=11, font="Helvetica", indent=0, gap=15):
    global y
    c.setFont(font, size)
    c.drawString(LEFT + indent, y, text)
    y -= gap


def question(n, stem, options, inline=False):
    line(f"{n}. {stem[0]}")
    for more in stem[1:]:
        line(more, indent=16)
    if inline:
        line("   ".join(f"{'ABCD'[i]}. {o}" for i, o in enumerate(options)), indent=16)
    else:
        for i, o in enumerate(options):
            line(f"{'ABCD'[i]}. {o}", indent=16, gap=14)
    global y
    y -= 6


new_page()
line("FIRST TERM EXAMINATION", 13, "Helvetica-Bold", gap=22)
line("SECTION A: ENGLISH LANGUAGE", 12, "Helvetica-Bold", gap=18)
line("Read the passage carefully and answer Questions 1 to 5.", 11, "Helvetica-Oblique", gap=18)
for p in [
    "Every morning before school, Ada spent twenty minutes reading in the small library near her home.",
    "At first she read only storybooks, but soon she borrowed books about science, history and farming.",
    "Her teacher noticed that Ada wrote clearer essays and asked better questions in class. By the end",
    "of the year, Ada had read forty books and had started a reading club for the younger pupils on her",
    "street, who met every Saturday to share what they had learnt.",
]:
    line(p, 10.5, gap=14)
y -= 10
question(1, ["Where did Ada read every morning?"], ["At school", "In a small library", "On the bus", "In the market"])
question(2, ["What did Ada read at first?"], ["Storybooks", "Science books", "Newspapers", "Farming guides"])
question(3, ["How many books had Ada read by the end of the year?"], ["Fourteen", "Twenty", "Forty", "Four hundred"])
question(4, ["The reading club met every"], ["Monday", "Friday", "Saturday", "Sunday"])
question(5, ["Which statement is NOT supported by the passage?"], [
    "Reading improved Ada's essays",
    "Ada shared her love of reading",
    "Ada read books on many subjects",
    "Reading is useful only during the first term",
])

new_page()
line("For Questions 6 to 8, choose the word nearest in meaning to the word in capitals.", 11, "Helvetica-Oblique", gap=18)
question(6, ["The hall was SPACIOUS."], ["Roomy", "Narrow", "Dirty", "Noisy"], inline=True)
question(7, ["She gave a BRIEF speech."], ["Long", "Short", "Loud", "Boring"], inline=True)
question(8, ["The answer was OBVIOUS."], ["Hidden", "Clear", "Wrong", "Strange"], inline=True)
question(9, ["Choose the correctly spelt word."], ["Accomodation", "Acommodation", "Accommodation", "Acomodation"])
question(10, ["He has been living here ______ 2019."], ["for", "since", "from", "at"], inline=True)
question(11, ["Choose the word with a different vowel sound."], ["seat", "meet", "beat", "bet"], inline=True)
question(12, ["The plural of 'child' is"], ["childs", "childes", "children", "childrens"], inline=True)
y -= 4
line("SECTION B: MATHEMATICS", 12, "Helvetica-Bold", gap=18)
question(13, ["Simplify 3x + 5x - 2x."], ["6x", "8x", "10x", "4x"], inline=True)
question(14, ["Find 15% of 200."], ["15", "20", "30", "300"], inline=True)
question(15, ["Solve 2y + 4 = 10."], ["y = 2", "y = 3", "y = 4", "y = 7"], inline=True)
question(16, ["Express 0.25 as a fraction."], ["1/2", "1/3", "1/4", "2/5"], inline=True)
question(17, ["What is the next prime number after 7?"], ["9", "11", "13", "15"], inline=True)

new_page()
# Question 18 with a right-angled triangle drawn to the right of the stem.
line("18. In the right-angled triangle ABC below, find the length of side AC.")
c.setLineWidth(1.2)
ax, ay = 200, y - 100
bx, by = ax, ay + 90
cx, cy = ax + 120, ay
c.line(ax, ay, bx, by)
c.line(bx, by, cx, cy)
c.line(cx, cy, ax, ay)
c.rect(ax, ay, 9, 9)
c.setFont("Helvetica", 10)
c.drawString(ax - 14, ay - 12, "A")
c.drawString(bx - 14, by + 2, "B")
c.drawString(cx + 4, cy - 12, "C")
c.drawString(ax - 34, ay + 42, "6 cm")
c.drawString(ax + 52, ay - 14, "8 cm")
y = ay - 34
for i, o in enumerate(["7 cm", "10 cm", "12 cm", "14 cm"]):
    line(f"{'ABCD'[i]}. {o}", indent=16, gap=14)
y -= 6
question(19, ["Find the mean of 4, 6, 8 and 10."], ["6", "7", "8", "9"], inline=True)
# Question 20 with a trapezium below the stem.
line("20. Find the area of the trapezium shown below.")
tx, ty = 170, y - 92
c.setLineWidth(1.2)
c.line(tx, ty, tx + 168, ty)                 # bottom: 14 cm
c.line(tx + 168, ty, tx + 120, ty + 60)
c.line(tx + 120, ty + 60, tx + 24, ty + 60)  # top: 8 cm
c.line(tx + 24, ty + 60, tx, ty)
c.setDash(3, 2)
c.line(tx + 24, ty + 60, tx + 24, ty)        # height: 5 cm
c.setDash()
c.setFont("Helvetica", 10)
c.drawString(tx + 60, ty + 66, "8 cm")
c.drawString(tx + 70, ty - 14, "14 cm")
c.drawString(tx + 28, ty + 26, "5 cm")
y = ty - 34
for i, o in enumerate(["44 sq cm", "55 sq cm", "70 sq cm", "110 sq cm"]):
    line(f"{'ABCD'[i]}. {o}", indent=16, gap=14)
y -= 14
line("END OF PAPER", 11, "Helvetica-Bold")
c.save()
print(out)
