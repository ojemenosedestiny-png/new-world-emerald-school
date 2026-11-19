"""Builds diagram-paper.pdf, a made-up two-page science paper used to test diagrams in the PDF importer.

It has a school crest above the title on page 1 (a letterhead, not a diagram), a small crest in the footer of
every page, Question 1 with two figures side by side, Question 3 whose figure comes after its choices at the
foot of the paper, and plain questions in between.

    python make-diagram-paper.py   (needs reportlab; writes diagram-paper.pdf beside this file)
"""
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

W, H = A4
LEFT = 56
out = Path(__file__).with_name("diagram-paper.pdf")
c = canvas.Canvas(str(out), pagesize=A4)
y = 0.0


def footer():
    c.setFillGray(0.3)
    c.rect(W - 90, 20, 30, 30, fill=1, stroke=0)
    c.setFillGray(0)


def line(text, size=11, font="Helvetica", indent=0, gap=16):
    global y
    c.setFont(font, size)
    c.drawString(LEFT + indent, y, text)
    y -= gap


def options(*opts):
    for letter, text in zip("ABCD", opts):
        line(f"{letter}. {text}", indent=18)
    global y
    y -= 8


def triangle(x, top, size):
    p = c.beginPath()
    p.moveTo(x, top - size)
    p.lineTo(x + size, top - size)
    p.lineTo(x, top)
    p.close()
    c.drawPath(p, stroke=1, fill=0)


# Page 1: letterhead crest, title, Question 1 with two figures, Question 2.
c.setFillGray(0.2)
c.circle(W / 2, H - 60, 26, fill=1, stroke=0)
c.setFillGray(0)
c.setFont("Helvetica-Bold", 13)
c.drawCentredString(W / 2, H - 110, "JSS 2 BASIC SCIENCE TEST")
footer()
y = H - 150
line("1. Figure P and Figure Q show two triangles. Which is larger?")
y -= 6
triangle(LEFT + 30, y, 90)
triangle(LEFT + 220, y, 60)
y -= 110
options("Figure P", "Figure Q", "They are equal", "Cannot tell")
line("2. Water boils at what temperature at sea level?")
options("50 C", "80 C", "100 C", "120 C")
c.showPage()

# Page 2: Question 3, its figure after the choices at the foot of the paper.
footer()
y = H - 80
line("3. Name the shape drawn below the choices.")
options("Square", "Circle", "Triangle", "Hexagon")
line("Look at the figure for Question 3 carefully")
c.rect(LEFT + 30, y - 80, 80, 80, stroke=1, fill=0)
c.save()
