"""Builds docs/ADMIN-GUIDE.pdf (school office) and docs/STAFF-GUIDE.pdf (teachers).

Run from anywhere: python docs/make-guides-pdf.py  (needs: pip install reportlab)
Plain, task-by-task instructions for non-technical staff. Contains no passwords or keys.
"""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, NextPageTemplate, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle

HERE = Path(__file__).resolve().parent
EMERALD = colors.HexColor("#176345")
EMERALD_SOFT = colors.HexColor("#e3efe8")
INK = colors.HexColor("#10232c")
MUTED = colors.HexColor("#5c6b70")
GOLD = colors.HexColor("#c8931c")
GOLD_SOFT = colors.HexColor("#f7eed8")
IVORY = colors.HexColor("#faf7f0")
LINE = colors.HexColor("#ddd6c6")
WHITE = colors.white
W, H = A4
MARGIN = 18 * mm
CW = W - 2 * MARGIN
SITE = "newworldemeraldprivateschool.com"
DATE = "24 October 2026"

base = dict(fontName="Helvetica", textColor=INK, leading=14.5, fontSize=10)
S = {
    "body": ParagraphStyle("body", **base, spaceAfter=6),
    "h1": ParagraphStyle("h1", fontName="Times-Bold", fontSize=21, leading=25, textColor=INK, spaceBefore=4, spaceAfter=4),
    "kicker": ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=EMERALD, spaceBefore=16, spaceAfter=2),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=EMERALD, spaceBefore=10, spaceAfter=4),
    "step": ParagraphStyle("step", **base, leftIndent=16, bulletIndent=2, spaceAfter=3),
    "bullet": ParagraphStyle("bullet", **base, leftIndent=12, bulletIndent=2, spaceAfter=3),
    "cell": ParagraphStyle("cell", **{**base, "fontSize": 9, "leading": 12}),
    "cellb": ParagraphStyle("cellb", **{**base, "fontName": "Helvetica-Bold", "fontSize": 9, "leading": 12}),
    "head": ParagraphStyle("head", **{**base, "fontName": "Helvetica-Bold", "fontSize": 8.8, "leading": 11, "textColor": WHITE}),
    "callout": ParagraphStyle("callout", **{**base, "fontSize": 9.4, "leading": 13.5}),
}


def P(text, style="body"):
    return Paragraph(text, S[style])


def steps(items):
    return [Paragraph(t, S["step"], bulletText=f"{i}.") for i, t in enumerate(items, 1)]


def bullets(items):
    return [Paragraph(t, S["bullet"], bulletText="•") for t in items]


def section(number, kicker, title):
    return [P(f"{number} · {kicker.upper()}", "kicker"), P(title, "h1"), Spacer(1, 4)]


def task(title, intro, items, tip=None):
    block = [P(title, "h2")]
    if intro:
        block.append(P(intro))
    block += steps(items)
    if tip:
        block += [Spacer(1, 3), callout(tip, "emerald")]
    return [KeepTogether(block)]


def table(rows, widths):
    data = [[Paragraph(str(c), S["head"] if r == 0 else (S["cellb"] if i == 0 else S["cell"])) for i, c in enumerate(row)] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
          ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
          ("BACKGROUND", (0, 0), (-1, 0), EMERALD)]
    st += [("BACKGROUND", (0, r), (-1, r), IVORY) for r in range(2, len(rows), 2)]
    t.setStyle(TableStyle(st))
    return t


def callout(text, tone="gold"):
    bg, edge = (GOLD_SOFT, GOLD) if tone == "gold" else (EMERALD_SOFT, EMERALD)
    t = Table([[Paragraph(text, S["callout"])]], colWidths=[CW])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                           ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    return t


def build(out, title, subtitle, header, audience, story):
    def cover(c, doc):
        c.saveState()
        c.setFillColor(INK); c.rect(0, 0, W, H, stroke=0, fill=1)
        c.setFillColor(EMERALD); c.rect(0, H * 0.36, W, 6, stroke=0, fill=1)
        c.setFillColor(GOLD); c.rect(0, H * 0.36 - 3, W * 0.42, 3, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 10); c.drawString(MARGIN, H - 40 * mm, "NEW WORLD EMERALD PRIVATE SCHOOL")
        c.setFillColor(WHITE); c.setFont("Times-Bold", 38)
        for i, line in enumerate(title):
            c.drawString(MARGIN, H - (62 + 15 * i) * mm, line)
        c.setFont("Helvetica", 13); c.setFillColor(colors.HexColor("#cfd8d4"))
        c.drawString(MARGIN, H - (77 + 15 * (len(title) - 1)) * mm, subtitle)
        c.setFont("Helvetica", 10)
        y = H * 0.36 - 26
        for line in [f"Website: https://{SITE}", f"Version: {DATE}", f"For: {audience}"]:
            c.drawString(MARGIN, y, line); y -= 16
        c.setFont("Helvetica", 8); c.setFillColor(colors.HexColor("#8fa3a0"))
        c.drawString(MARGIN, 14 * mm, "Never share your sign-in code or a student's password. The school will never ask for them by phone.")
        c.restoreState()

    def page(c, doc):
        c.saveState()
        c.setFillColor(IVORY); c.rect(0, H - 13 * mm, W, 13 * mm, stroke=0, fill=1)
        c.setFillColor(EMERALD); c.rect(0, H - 13 * mm, W, 1.2, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 7.5); c.drawString(MARGIN, H - 8.5 * mm, header)
        c.setFont("Helvetica", 7.5); c.setFillColor(MUTED)
        c.drawRightString(W - MARGIN, H - 8.5 * mm, DATE)
        c.drawRightString(W - MARGIN, 10 * mm, f"Page {doc.page}")
        c.drawString(MARGIN, 10 * mm, SITE)
        c.restoreState()

    doc = BaseDocTemplate(str(HERE / out), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=20 * mm, bottomMargin=18 * mm,
                          title=" ".join(title), author="New World Emerald Private School", subject=subtitle)
    frame = Frame(MARGIN, 18 * mm, CW, H - 38 * mm, id="body")
    doc.addPageTemplates([PageTemplate(id="cover", frames=[frame], onPage=cover), PageTemplate(id="content", frames=[frame], onPage=page)])
    doc.build([NextPageTemplate("content"), PageBreak(), *story])
    print("wrote", out)


# ---------- Shared: signing in ----------
def staff_sign_in(number, office=False):
    return [
        *section(number, "Getting started", "Signing in"),
        P("Staff do not have a password for the website. You sign in with a code sent to your school email address."),
        *task("Sign in", None, [
            (f"Go to <b>{SITE}</b> and tap <b>Admin Portal</b> at the top of the page. This opens the website admin; the staff portal is at <b>{SITE}/portal/manage</b>."
             if office else f"Open <b>{SITE}/teacher</b> (the link in your invitation email) and bookmark it."),
            "Enter your approved email address and tap <b>Continue</b>.",
            "Open your email, copy the six-digit code, and type it in. The code works once and expires after a few minutes.",
            "You arrive at your dashboard. The menu on the left (or behind the menu button on a phone) lists everything you can do.",
        ], "No code? Check your spam folder and wait a minute before asking for another. If your email is not approved you will see “Not approved for the portal”: ask the school office to add you."),
        *task("Signing out and shared computers", None, [
            "Tap your name at the bottom of the menu, then <b>Sign out</b>.",
            "The portal also signs you out by itself after a period of no activity.",
            "On a shared or school computer, always sign out and close the browser when you finish.",
        ]),
    ]


def teaching_tasks(start):
    n = start
    out = []
    out += [*section(n, "Daily", "Attendance register"),
            P("Take the register once each school day. It feeds the student's attendance page and the “days present” on report cards."),
            *task("Take today's register", None, [
                "Open <b>Attendance</b>. Choose the class; the date is today.",
                "Tap <b>Mark the rest present</b>, then change anyone who is late (L), absent (A) or excused (E).",
                "Add a short note for absent, late or excused students if you know the reason (for example “Hospital appointment”).",
                "Tap <b>Save register</b>. You can open the same day again and correct it; saving replaces the earlier marks.",
            ], "Late counts as present. You cannot take a register for a future date, or for a date more than a year ago."),
            *task("See attendance over a period", None, [
                "In <b>Attendance</b>, tap <b>Summary</b> and choose the dates.",
                "Each student's present, late, absent and excused days are shown, with an attendance rate. Rates below 80% are shown in red.",
            ])]
    n += 1
    out += [*section(n, "Homework", "Assignments"),
            *task("Set an assignment", None, [
                "Open <b>Assignments</b> and tap <b>New assignment</b>.",
                "Choose the class, type the subject, title and instructions, set the due date and time, and the marks it is out of.",
                "Tick <b>Publish</b> when it is ready for students. Unpublished assignments are drafts only you can see.",
            ]),
            *task("Mark work that has been handed in", None, [
                "Open the assignment to see who has handed in. Late work is labelled <b>Late</b>.",
                "Read the answer and open any photos the student attached.",
                "Enter a score and short feedback, then save. The student sees the score and feedback straight away.",
            ], "Once marked, a student can no longer change their work. Before marking, they can update it as often as they like.")]
    n += 1
    out += [*section(n, "Messages", "Messages from students"),
            P("Students can message their class teacher and the school office from their portal. Messages are kept by the school."),
            *task("Read and reply", None, [
                "<b>Messages</b> in the menu shows a red number when something is unread.",
                "Tap a conversation to open it. Opening it marks the student's messages as read.",
                "Type your reply and press <b>Enter</b> (or the send button). Shift + Enter starts a new line.",
            ], "Keep replies professional and about school. Do not share personal phone numbers or social media. If a message worries you about a child's safety, tell the school's safeguarding lead the same day.")]
    n += 1
    out += [*section(n, "Exams", "Computer-based tests (CBT)"),
            *task("Create an exam", None, [
                "Open <b>Exams</b> and tap <b>New exam</b>. Fill in the title, subject, class, duration and the window when it opens and closes.",
                "Add questions: multiple choice (tick the correct option) or written (add a marking guide if you like). You can also upload a typed PDF and the questions are read from it; always check them.",
                "Leave it unpublished while you prepare. When ready, tick <b>Publish</b> and save.",
            ]),
            *task("Computer-based test options", "These are in the exam editor under <b>Computer-based test options</b> (on-screen exams only, not PDF papers).", [
                "<b>Shuffle question order</b>: each student gets the questions in a different order.",
                "<b>Shuffle answer options</b>: A to D are mixed for each student. Marking stays correct automatically.",
                "<b>Question bank</b>: write more questions than you need and set how many each student gets (for example 20 from a bank of 50). Every question must carry the same marks.",
                "<b>Lockdown mode</b>: the exam opens full screen, copy, paste and right-click are off, and every time a student leaves the exam screen is counted. You see the count when marking.",
            ], "A web browser cannot completely stop a student opening another app. Lockdown discourages it and records it, so still supervise the room."),
            *task("Mark and release results", None, [
                "Multiple-choice questions are marked automatically when the student submits.",
                "Open <b>Marking</b> for written answers, give each a score and feedback, and save.",
                "When every attempt is marked and the exam window has closed, open <b>Exams</b> and tap <b>Release results</b>. Students then see their scores.",
                "If a student needs more time, or must restart, use the controls on their attempt in <b>Marking</b>.",
            ], "Once any student has started, the exam's questions are locked so everyone sits the same paper.")]
    n += 1
    out += [*section(n, "Term end", "Report cards"),
            *task("Prepare report cards", None, [
                "Open <b>Report cards</b>, choose the term and class.",
                "Enter scores for each subject, then remarks.",
                "In the remarks sheet, choose the register dates and tap <b>Fill from attendance register</b> to fill days present and days open.",
                "Check everything, then release. Students and parents can view and download the report as a PDF.",
            ])]
    n += 1
    out += [*section(n, "Class content", "Notes, announcements and photos"),
            *bullets([
                "<b>Revision notes</b>: share notes and PDFs with a class. Students see them in their Library, grouped by subject with search.",
                "<b>Announcements</b>: short messages for a class. They appear in the student's notices and notification bell.",
                "<b>Photo approvals</b>: students can upload a profile photo; it only shows after a member of staff approves it.",
            ])]
    return out, n + 1


# ---------- Staff (teacher) guide ----------
staff = [*staff_sign_in(1)]
more, nxt = teaching_tasks(2)
staff += more
staff += [*section(nxt, "Help", "If something goes wrong"),
          table([["Problem", "What to do"],
                 ["I don't see my class", "The office assigns classes to teachers. Ask them to add the class to your account."],
                 ["A student cannot sign in", "Ask the office to send a new activation or password link to the parent's email."],
                 ["An exam will not let me edit questions", "A student has already started it. Create a copy instead (Exams → Duplicate)."],
                 ["The page says something failed", "Try again. If it keeps failing, note the time and what you clicked and tell the office."]],
                [55 * mm, CW - 55 * mm])]
build("STAFF-GUIDE.pdf", ["Teacher Guide"], "Registers, homework, exams, messages and report cards",
      "NEW WORLD EMERALD · TEACHER GUIDE", "teachers using the staff portal", staff)


# ---------- Admin (school office) guide ----------
admin = [*section(1, "Overview", "Two places to work"),
         table([["Area", "Where", "What it is for"],
                ["Admin Portal (website admin)", "/admin", "Admissions, website content and news, live video updates, academic calendar, graphics studio, store, fees and bank accounts."],
                ["Staff portal (school management)", "/portal/manage", "Students, teachers, classes, attendance, assignments, exams, report cards, messages, gallery, events and security."]],
               [48 * mm, 30 * mm, CW - 78 * mm]),
         Spacer(1, 6),
         P(f"Both are on {SITE} and use the same sign-in. From the staff portal menu, <b>Website admin</b> takes you to /admin.")]
admin += staff_sign_in(2, office=True)
admin += [*section(3, "People", "Students, teachers and classes"),
          *task("Create classes first", None, [
              "In the staff portal open <b>Classes</b> and add each class (for example JSS 1, Primary 4).",
              "Use the same class names when you set class fees in /admin, so fees match the right students.",
          ]),
          *task("Enrol a student", None, [
              "Open <b>Students</b> and tap <b>Enrol student</b>. Enter the name, class and the parent's email.",
              "A student ID (for example NWE/2026/00001) is created and an email goes to the parent with the login details and a link to set a password.",
              "For many students at once, use <b>Enrol class list</b>.",
              "If a parent did not get the email, use <b>Activation link</b> (or <b>Reset link</b> for a forgotten password) on the student to send a new one.",
          ], "Students sign in at the Student Portal with their student ID and password. Staff never need to know a student's password."),
          *task("Add a teacher and assign classes", None, [
              "Open <b>Teachers</b>, tap <b>Approve teacher</b>, and enter the teacher's email, name and the classes they teach.",
              f"The teacher is emailed an invitation with their classes and the teacher link, <b>{SITE}/teacher</b>. Use <b>Send invite</b> to send it again, or <b>Copy</b> to share the link on WhatsApp.",
              "They sign in with a code sent to that email and see only their own classes. Use <b>Edit</b> to change their classes at any time.",
              "Use <b>Deactivate</b> when someone leaves; they lose access immediately.",
          ]),
          *task("Student fee statement", None, [
              "In <b>Students</b>, tap <b>Fees</b> on a student to see their fee statement: class fees, individual charges, payments, and the balance.",
              "Students see the same statement under <b>Fees</b> in their portal, with a button to pay.",
          ])]
admin += [*section(4, "Money", "Fees, payments and the store"),
          *task("Set up how parents pay", None, [
              "In /admin open <b>Store and fees</b>.",
              "Under <b>Bank accounts for payment</b>, add up to three labelled accounts (for example “School fees”). Parents see them with a copy button.",
              "Add <b>class fee schedules</b> for each class, term and session, and <b>individual charges</b> for single students (for example an excursion). Each charge gets a reference the parent uses when paying.",
          ]),
          *task("Confirm a payment", None, [
              "Parents pay by bank transfer and submit a payment report, usually with a screenshot.",
              "In <b>Store and fees</b>, open the report, tap <b>View payment screenshot</b>, and check your bank statement.",
              "Set it to <b>Confirmed</b> when the money has arrived, or <b>Rejected</b> with a note if not. A confirmed payment marks the fee as paid on the student's statement.",
          ], "Only confirm a payment after you see it in the school's bank account. A screenshot alone is not proof.")]
admin += [*task("For the Director: the weekly dashboard", f"The Director has a private dashboard at <b>{SITE}/director</b>. Only the Director's email can open it; other administrators are refused.", [
              "Sign in with the Director's email and the six-digit code.",
              "See the week at a glance: what needs attention, admissions, students, attendance by class, exams and homework, fees, messages and security.",
              "Every Monday at 7 am the same report arrives by email. Use <b>Email me this report</b> or <b>Print</b> at any time.",
          ], "The Director's email must be set by the developer in Render (SCHOOL_DIRECTOR_EMAILS) and also be an approved administrator.")]
admin += [*section(5, "Website", "Keeping the website current"),
          *bullets([
              "<b>Admissions</b>: applications from the website arrive here. A red number shows new ones.",
              "<b>Website content</b>: edit pages, news, photos, and upload the prospectus PDF.",
              "<b>Live updates</b>: post videos. Use a YouTube link, or upload a video file of up to 500 MB.",
              "<b>Academic calendar</b>: upload the weekly or term calendar as a PDF.",
              "<b>Events calendar</b> and <b>Gallery</b> (staff portal): school events and photo albums for students.",
          ])]
admin += [*section(6, "Teaching", "Everything teachers can do"),
          P("As an administrator you can do everything a teacher can, for every class. The next sections are the same as the Teacher Guide."),
          callout("To try the computer-based tests, open <b>Exams</b> and tap <b>Add practice CBT to every class</b>. Each class gets a 15-minute practice test, open for 7 days, using a question bank, shuffling and lockdown. Sign in as a student to sit it, then hide it in Exams when you are done.", "emerald"),
          PageBreak()]
more, nxt = teaching_tasks(7)
admin += more
admin += [*section(nxt, "Security", "Keeping accounts safe"),
          *bullets([
              "<b>Sessions</b>: see who is signed in and sign out a lost device.",
              "<b>Audit log</b> (main administrator only): a record of important changes and who made them.",
              "Each student has an <b>Activity</b> button showing their recent sign-ins.",
              "Students are locked out for a while after too many wrong passwords. Send a password-reset link if needed.",
              "Never share sign-in codes or ask a student for their password. The website's keys live only with the developer in the hosting settings.",
          ]),
          *section(nxt + 1, "Help", "If something goes wrong"),
          table([["Problem", "What to do"],
                 ["A parent says no email arrived", "Check the parent's email is correct on the student, then use Activation link or Reset link. Ask them to check spam."],
                 ["A payment is missing from a statement", "Check the payment report uses the student's ID exactly, and that it is Confirmed."],
                 ["Class fees do not show for a student", "The fee schedule's class name must match the portal class name, and the schedule must be active."],
                 ["The website looks broken", "Note the time and the page, take a screenshot, and contact the developer."]],
                [58 * mm, CW - 58 * mm])]
build("ADMIN-GUIDE.pdf", ["School Office Guide"], "Running the website, portal and payments",
      "NEW WORLD EMERALD · SCHOOL OFFICE GUIDE", "the school office and administrators", admin)
