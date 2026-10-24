"""Builds docs/ARCHITECTURE.pdf: architecture and handover guide for New World Emerald's site.

Run from anywhere: python docs/make-architecture-pdf.py  (needs: pip install reportlab)
"""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, NextPageTemplate, PageBreak, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

OUT = str(Path(__file__).resolve().parent / "ARCHITECTURE.pdf")
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

base = dict(fontName="Helvetica", textColor=INK, leading=14.5, fontSize=10)
S = {
    "body": ParagraphStyle("body", **base, spaceAfter=6),
    "small": ParagraphStyle("small", **{**base, "fontSize": 8.6, "leading": 12, "textColor": MUTED}),
    "h1": ParagraphStyle("h1", fontName="Times-Bold", fontSize=21, leading=25, textColor=INK, spaceBefore=4, spaceAfter=4),
    "kicker": ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=EMERALD, spaceAfter=2),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=EMERALD, spaceBefore=10, spaceAfter=4),
    "bullet": ParagraphStyle("bullet", **base, leftIndent=12, bulletIndent=2, spaceAfter=3),
    "cell": ParagraphStyle("cell", **{**base, "fontSize": 8.8, "leading": 11.6}),
    "cellb": ParagraphStyle("cellb", **{**base, "fontName": "Helvetica-Bold", "fontSize": 8.8, "leading": 11.6}),
    "head": ParagraphStyle("head", **{**base, "fontName": "Helvetica-Bold", "fontSize": 8.6, "leading": 11, "textColor": WHITE}),
    "callout": ParagraphStyle("callout", **{**base, "fontSize": 9.4, "leading": 13.5}),
}


def P(text, style="body"):
    return Paragraph(text, S[style])


def bullets(items):
    return [Paragraph(t, S["bullet"], bulletText="\u2022") for t in items]


def section(number, kicker, title):
    return [P(f"{number} \u00b7 {kicker.upper()}", "kicker"), P(title, "h1"), Spacer(1, 4)]


def table(rows, widths, header=True, bold_first=True, check_last=False):
    data = []
    for r, row in enumerate(rows):
        style = "head" if header and r == 0 else "cell"
        data.append([Paragraph(str(c), S["cellb"] if (bold_first and c and r > 0 and i == 0) else S[style]) for i, c in enumerate(row)])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
    ]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), EMERALD)]
        for r in range(1, len(rows)):
            if r % 2 == 0:
                st.append(("BACKGROUND", (0, r), (-1, r), IVORY))
    if check_last:
        # An empty box to tick by hand in the last column.
        for r in range(1, len(rows)):
            st.append(("BOX", (-1, r), (-1, r), 0.9, MUTED))
            st.append(("RIGHTPADDING", (-1, r), (-1, r), 2))
    t.setStyle(TableStyle(st))
    return t


def callout(text, tone="gold"):
    bg, edge = (GOLD_SOFT, GOLD) if tone == "gold" else (EMERALD_SOFT, EMERALD)
    t = Table([[Paragraph(text, S["callout"])]], colWidths=[W - 2 * MARGIN])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


# ---------- Architecture diagram ----------
def box(d, x, y, w, h, title, sub="", fill=WHITE, stroke=EMERALD, title_color=INK, bold=True):
    d.add(Rect(x, y, w, h, rx=6, ry=6, fillColor=fill, strokeColor=stroke, strokeWidth=1.1))
    d.add(String(x + w / 2, y + h - 15, title, fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=8.8, fillColor=title_color, textAnchor="middle"))
    for i, line in enumerate(sub.split("\n") if sub else []):
        d.add(String(x + w / 2, y + h - 27 - i * 10, line, fontName="Helvetica", fontSize=7.2, fillColor=MUTED, textAnchor="middle"))


def arrow(d, x1, y1, x2, y2, label="", color=EMERALD, dash=None, label_at=None):
    import math
    ln = Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=1.1)
    if dash:
        ln.strokeDashArray = dash
    d.add(ln)
    a = math.atan2(y2 - y1, x2 - x1)
    s = 5
    d.add(Polygon([x2, y2, x2 - s * math.cos(a - 0.45), y2 - s * math.sin(a - 0.45), x2 - s * math.cos(a + 0.45), y2 - s * math.sin(a + 0.45)], fillColor=color, strokeColor=color))
    if label:
        lx, ly = label_at or ((x1 + x2) / 2 + 4, (y1 + y2) / 2 + 3)
        for i, line in enumerate(label.split("\n")):
            d.add(String(lx, ly - i * 8.5, line, fontName="Helvetica", fontSize=6.8, fillColor=MUTED))


def architecture_diagram():
    dw, dh = W - 2 * MARGIN, 400
    d = Drawing(dw, dh)
    d.add(Rect(0, 0, dw, dh, fillColor=IVORY, strokeColor=None))
    # Left/centre column: people -> Cloudflare -> Render
    box(d, 120, 350, 180, 40, "Parents, students, teachers, office", "browsers and phones")
    box(d, 120, 290, 180, 40, "Cloudflare DNS", "newworldemeraldprivateschool.com", fill=GOLD_SOFT, stroke=GOLD)
    arrow(d, 210, 350, 210, 331, "HTTPS")
    d.add(Rect(8, 112, 300, 160, rx=8, ry=8, fillColor=EMERALD_SOFT, strokeColor=EMERALD, strokeWidth=1.3))
    d.add(String(158, 257, "Render web service (one app)", fontName="Helvetica-Bold", fontSize=9.4, fillColor=EMERALD, textAnchor="middle"))
    box(d, 20, 128, 132, 112, "Website and screens", "React 19 + Vite\npublic site, /admin,\n/portal (students),\n/portal/manage (staff),\n/commerce (payments)")
    box(d, 166, 128, 130, 112, "API server", "Express 5 + TypeScript\nchecks every request\nagainst the contract,\nsigns uploads, sends\nemail, serves the site")
    arrow(d, 152, 184, 165, 184)
    arrow(d, 210, 290, 210, 273)
    # GitHub, top left
    box(d, 8, 290, 100, 40, "GitHub", "code + automatic tests", stroke=MUTED)
    arrow(d, 58, 290, 58, 273, "auto-deploy", color=MUTED, label_at=(62, 279))
    # Right column: outside services, fed by the API server
    rx, rw = dw - 160, 152
    services = [(292, "Render PostgreSQL", "all school data"), (234, "Cloudinary", "photos, videos, PDFs"),
                (176, "Resend", "activation, reset, codes"), (118, "Clerk", "staff sign-in (email code)")]
    for y, title, sub in services:
        box(d, rx, y, rw, 40, title, sub)
        arrow(d, 296, 184, rx - 1, y + 20)
    # Big videos: browser straight to Cloudinary
    arrow(d, 300, 362, rx - 2, 262, color=GOLD, dash=[3, 2])
    d.add(String(rx + 4, 356, "big videos upload", fontName="Helvetica", fontSize=6.8, fillColor=GOLD))
    d.add(String(rx + 4, 347.5, "straight to Cloudinary", fontName="Helvetica", fontSize=6.8, fillColor=GOLD))
    # Bottom notes
    box(d, 8, 24, 230, 56, "Old hosting server (not part of this app)", "school email: mail.newworldemeraldprivateschool.com\nnever change the mail, MX or SPF records", stroke=GOLD)
    box(d, 252, 24, dw - 260, 56, "Inside the API server", "audit log · rate limits · security headers\nsigned upload links · private files · sessions")
    return d


# ---------- Page decoration ----------
def cover_page(c, doc):
    c.saveState()
    c.setFillColor(INK)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(EMERALD)
    c.rect(0, H * 0.36, W, 6, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.rect(0, H * 0.36 - 3, W * 0.42, 3, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, H - 40 * mm, "NEW WORLD EMERALD PRIVATE SCHOOL")
    c.setFillColor(WHITE)
    c.setFont("Times-Bold", 38)
    c.drawString(MARGIN, H - 62 * mm, "Website and Portal")
    c.drawString(MARGIN, H - 77 * mm, "Architecture")
    c.setFont("Helvetica", 13)
    c.setFillColor(colors.HexColor("#cfd8d4"))
    c.drawString(MARGIN, H - 92 * mm, "How the system is built, run and handed over")
    c.setFont("Helvetica", 10)
    y = H * 0.36 - 26
    for line in ["Live site: https://newworldemeraldprivateschool.com",
                 "Repository: github.com/ojemenosedestiny-png/new-world-emerald-school",
                 "Version: 24 October 2026 (commit 890f160 and later)",
                 "Audience: school leadership and the developer who takes over"]:
        c.drawString(MARGIN, y, line)
        y -= 16
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#8fa3a0"))
    c.drawString(MARGIN, 14 * mm, "Contains no passwords or keys. Keys live only in Render \u2192 Environment.")
    c.restoreState()


def content_page(c, doc):
    c.saveState()
    c.setFillColor(IVORY)
    c.rect(0, H - 13 * mm, W, 13 * mm, stroke=0, fill=1)
    c.setFillColor(EMERALD)
    c.rect(0, H - 13 * mm, W, 1.2, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 7.5)
    c.setFillColor(EMERALD)
    c.drawString(MARGIN, H - 8.5 * mm, "NEW WORLD EMERALD \u00b7 ARCHITECTURE AND HANDOVER")
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawRightString(W - MARGIN, H - 8.5 * mm, "24 October 2026")
    c.drawRightString(W - MARGIN, 10 * mm, f"Page {doc.page}")
    c.drawString(MARGIN, 10 * mm, "newworldemeraldprivateschool.com")
    c.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=20 * mm, bottomMargin=18 * mm,
                      title="New World Emerald: Website and Portal Architecture", author="New World Emerald Private School",
                      subject="Architecture and handover guide")
frame = Frame(MARGIN, 18 * mm, W - 2 * MARGIN, H - 38 * mm, id="body")
doc.addPageTemplates([PageTemplate(id="cover", frames=[frame], onPage=cover_page),
                      PageTemplate(id="content", frames=[frame], onPage=content_page)])
CW = W - 2 * MARGIN
story = [NextPageTemplate("content"), PageBreak()]

# ---------- Contents ----------
story += [P("CONTENTS", "kicker"), P("What this document covers", "h1"), Spacer(1, 6)]
toc = [("1", "The system at a glance"), ("2", "Architecture diagram"), ("3", "Technology"), ("4", "How the code is organised"),
       ("5", "How a request works"), ("6", "Data: what is stored"), ("7", "Sign-in, roles and permissions"),
       ("8", "Features by area"), ("9", "Files, video and email"), ("10", "Security"),
       ("11", "Hosting, domain and deployment"), ("12", "Settings (environment variables)"), ("13", "Testing and quality"),
       ("14", "How it was developed"), ("15", "Handover checklist"), ("16", "Known items and recommended next steps")]
story.append(table([["#", "Section"]] + [[n, t] for n, t in toc], [14 * mm, CW - 14 * mm]))
story.append(PageBreak())

# ---------- 1 ----------
story += section(1, "Overview", "The system at a glance")
story.append(P("The school's website and portals are <b>one web application</b>, hosted on Render and reached at "
               "<b>newworldemeraldprivateschool.com</b>. It replaced the earlier WordPress site on 24 October 2026. "
               "Everyone uses the same address; what they see depends on who they are."))
story.append(table([
    ["Area", "Address", "Who uses it", "What it does"],
    ["Public website", "/", "Families, visitors", "School information, admissions form, news, live video updates, calendar, gallery, prospectus."],
    ["Payments and store", "/commerce", "Parents", "Uniform and book orders, fee prices, school bank accounts, payment reports with screenshots."],
    ["School office admin", "/admin", "Website administrators", "Dashboard, admissions, website content editor, live updates, calendar, store and fees, media and email checks."],
    ["Learning portal (staff)", "/portal/manage", "Administrators, teachers", "Classes, students, teachers, exams (CBT), marking, report cards, events, gallery, photo approvals, security."],
    ["Student portal", "/portal", "Students", "Phone-style home, exams, grade sheet, report cards, events calendar, staff directory, gallery, library, profile photo."],
], [32 * mm, 26 * mm, 32 * mm, CW - 90 * mm]))
story.append(Spacer(1, 8))
story.append(callout("<b>In one sentence:</b> a React website and an Express API run together as one Render service, keep data in a "
                     "PostgreSQL database, store files on Cloudinary, send email through Resend, and use Clerk for staff sign-in. "
                     "Students sign in with their own Student ID and password, managed by the site itself.", "emerald"))
story.append(PageBreak())

# ---------- 2 ----------
story += section(2, "Architecture", "Architecture diagram")
story.append(architecture_diagram())
story.append(Spacer(1, 8))
story += bullets([
    "<b>One service:</b> the API server also serves the built website, so sign-in cookies stay on one address and there is no separate frontend host.",
    "<b>Cloudflare</b> only answers \u201cwhere is this domain\u201d (DNS) and passes traffic to Render; Render provides the HTTPS certificate.",
    "<b>Outside services</b> are called only by the API server, except big video uploads, which go from the admin's browser straight to Cloudinary using a short-lived signed permission from the server.",
    "<b>School email</b> is not part of this system. It still runs on the old hosting server and must keep working independently.",
])
story.append(PageBreak())

# ---------- 3 ----------
story += section(3, "Technology", "Technology")
story.append(table([
    ["Layer", "Technology", "Why"],
    ["Screens", "React 19, Vite 7, Tailwind CSS 4, TanStack Query, wouter, framer-motion, Recharts", "Fast, modern, mobile-first; pages load only the code they need."],
    ["API", "Node.js 24, Express 5, TypeScript 5.9", "One language across the whole project."],
    ["Contract", "OpenAPI 3.1 YAML \u2192 Orval code generation", "Every request and response is defined once; validators and screen hooks are generated from it."],
    ["Validation", "Zod (generated)", "The server rejects any request that does not match the contract."],
    ["Database", "PostgreSQL 16 on Render, Drizzle ORM", "Reliable relational data; table changes are applied by the build."],
    ["Staff sign-in", "Clerk (production instance, free plan)", "Managed accounts and email codes for staff."],
    ["Student sign-in", "Built in: scrypt password hashes, server sessions", "Students have no email-based accounts; the school controls them fully."],
    ["Files", "Cloudinary (public CDN + private authenticated files)", "Photos, videos and PDFs, with a fast CDN for the website."],
    ["Email", "Resend (verified sending domain)", "Activation links, confirmations, password resets, staff sign-in codes."],
    ["Hosting", "Render (web service + PostgreSQL), Cloudflare DNS", "Simple deploys straight from GitHub."],
    ["Quality", "Node test runner, Vitest + Testing Library, GitHub Actions CI, Playwright checks", "Every change is tested before and after it reaches the live site."],
], [26 * mm, 70 * mm, CW - 96 * mm]))
story.append(PageBreak())

# ---------- 4 ----------
story += section(4, "Codebase", "How the code is organised")
story.append(P("The repository is a <b>pnpm monorepo</b>: several packages in one repository that share code and settings."))
story.append(table([
    ["Folder", "Contents"],
    ["artifacts/new-world-emerald", "The website and every screen. <i>src/pages</i> (one file per address), <i>src/components</i> (website sections, admin tools), <i>src/portal</i> (student and staff portals), <i>tests</i> (screen tests)."],
    ["artifacts/api-server", "The API and web server. <i>src/routes</i> (one file per area: portal, storage, commerce, accounts\u2026), <i>src/lib</i> (security, email, Cloudinary, sign-in, tests)."],
    ["lib/api-spec", "The API contract (<i>openapi.yaml</i> plus <i>portal, reports, security, accounts, community, media</i> YAML files)."],
    ["lib/api-zod, lib/api-client-react", "Generated from the contract. Never edited by hand."],
    ["lib/db", "Database tables (<i>src/schema</i>), one file per area."],
    ["scripts/render-build.sh", "Render's build: checks key formats, installs, updates database tables, builds."],
    ["docs", "<i>DEPLOY-RENDER.md</i> (hosting, domain, accounts, step by step) and this document."],
    [".github/workflows/ci.yml", "Automatic tests on every push to main, portal-upgrade and the deploy branch."],
    ["README.md", "Starting point for developers: commands and rules."],
], [52 * mm, CW - 52 * mm]))
story.append(PageBreak())

# ---------- 5 ----------
story += section(5, "Request flow", "How a request works")
story.append(P("Every feature follows the same path, which keeps the code predictable and safe:"))
story += bullets([
    "<b>1. Contract first.</b> The developer describes the new request in <i>lib/api-spec</i> (fields, limits, responses).",
    "<b>2. Generate.</b> <i>pnpm --filter @workspace/api-spec run codegen</i> creates Zod validators for the server and typed React Query hooks for the screens.",
    "<b>3. Server.</b> The route validates the request with the generated validator, checks who is asking, then reads or writes the database.",
    "<b>4. Screen.</b> The page calls the generated hook; data is cached and refreshed automatically.",
])
story.append(Spacer(1, 4))
story.append(P("Who is asking is decided once per request:", "h2"))
story += bullets([
    "<b>Website management</b> (admin tools) is <b>private by default</b>: any address not on a short public list in <i>website-admin.ts</i> requires an approved administrator (\u201cfail closed\u201d).",
    "<b>Portal requests</b> work out the role in order: administrator, then teacher, then student (from the portal cookie), otherwise guest.",
    "<b>Changes by staff</b> are written to the audit log automatically, with secrets removed.",
])
story.append(PageBreak())

# ---------- 6 ----------
story += section(6, "Data", "Data: what is stored")
story.append(P("All data lives in one PostgreSQL database on Render. Tables by area:"))
story.append(table([
    ["Area", "Tables"],
    ["Website", "site_content (editable text, photos, documents), live_updates (videos and YouTube links), academic_calendar (weekly PDFs), admission_applications"],
    ["Store and fees", "store_products, store_orders, class_fee_schedules, individual_fee_charges, fee_payment_reports, school_commerce_settings (instructions and bank accounts)"],
    ["Portal people", "portal_classes, portal_students, portal_teachers, portal_sessions, portal_account_tokens, portal_id_sequences, portal_login_events"],
    ["Teaching", "portal_exams, portal_attempts, portal_materials, portal_notices, portal_files (exam PDFs)"],
    ["Report cards", "portal_terms, portal_subjects, portal_scores, portal_report_cards, portal_report_releases"],
    ["Student life", "portal_events, portal_albums, portal_album_photos, portal_images (all private photos, including payment screenshots)"],
    ["Files and audit", "media_objects (website files on Cloudinary), portal_audit_log"],
    ["Staff accounts", "users, sessions (links from Clerk sign-in to the school's records)"],
], [32 * mm, CW - 32 * mm]))
story.append(Spacer(1, 6))
story.append(callout("<b>Rule for table changes:</b> the build applies table changes to the live database automatically, so changes must only "
                     "<b>add</b> (new tables, new columns with defaults). Never drop or rename a column without a planned migration and a backup."))
story.append(PageBreak())

# ---------- 7 ----------
story += section(7, "Access", "Sign-in, roles and permissions")
story.append(table([
    ["Role", "How they sign in", "What they can do"],
    ["Website administrator", "Clerk, approved email listed in SCHOOL_ADMIN_EMAILS", "Everything in /admin and the Learning portal."],
    ["Super administrator", "As above, listed in SCHOOL_SUPER_ADMIN_EMAILS (or the first admin)", "Also sees the audit log."],
    ["Teacher", "Clerk, email approved in the Learning portal (Teachers)", "Only their own classes: exams, marking, notes, notices, photo approvals."],
    ["Student", "Student ID (e.g. NWE/2026/00001) and their own password", "Their own exams, results, report cards and student-life features."],
    ["Visitor", "No sign-in", "Public website, admissions form, store, payment reports."],
], [34 * mm, 62 * mm, CW - 96 * mm]))
story.append(P("Student accounts", "h2"))
story += bullets([
    "The office enrols a student; the site creates the Student ID automatically (NWE/<i>year</i>/<i>number</i>).",
    "An email with the Student ID and a one-time <b>create-password link</b> (valid 72 hours) goes to the student or parent email.",
    "After the student chooses a password, a <b>confirmation email</b> with their sign-in details follows (never the password).",
    "Passwords: at least 10 characters with a letter and a number, stored as scrypt hashes. Repeated wrong passwords lock the account for a while.",
    "Sessions can be listed and revoked by administrators; a password change signs out all other devices.",
])
story.append(P("Staff sign-in", "h2"))
story.append(P("Staff use Clerk with <b>email verification codes</b>. Clerk's free plan has no two-factor in production, so "
               "<b>REQUIRE_ADMIN_MFA must stay off</b>; the admin email inbox is therefore the key to admin access and needs strong "
               "protection (strong password and Google 2-Step Verification)."))
story.append(PageBreak())

# ---------- 8 ----------
story += section(8, "Features", "Features by area")
story.append(table([
    ["Area", "Features"],
    ["Public website", "Homepage sections editable in /admin (text, photos, documents, show/hide), admissions form, news, live updates (uploaded video up to 500 MB or YouTube link), weekly calendar PDFs, gallery, prospectus download, top bar with Student Portal and Admin Portal."],
    ["Payments and store", "Store catalogue with stock, order requests, fee schedules, individual charges, up to three school bank accounts with copy buttons, payment reports, payment screenshots (also \u201cAlready paid?\u201d later), office review."],
    ["School office (/admin)", "Dashboard with key numbers and Learning portal card, admissions with status, website content editor, live updates, academic calendar, graphics studio, store and fees, Media storage test, Email test."],
    ["Learning portal (staff)", "Classes, students (single and bulk enrolment with activation emails), teachers (role, subjects, photo, directory), CBT exams (interactive or PDF, timers, results release), marking, report cards (terms, subjects, scores, broadsheet, printable cards), notes, notices, events calendar, gallery albums, photo approvals, sessions, audit log."],
    ["Student portal", "Phone-style home (tiles, bell, search, bottom bar), exams, grade sheet, report cards, library (notes), notices, events calendar, staff directory, gallery, profile with photo (approved by staff) and password change, dark mode."],
], [34 * mm, CW - 34 * mm]))
story.append(PageBreak())

# ---------- 9 ----------
story += section(9, "Files and email", "Files, video and email")
story.append(P("Cloudinary", "h2"))
story += bullets([
    "<b>Website files</b> (photos, videos, calendar PDFs, product photos) are public and served from Cloudinary's CDN. The site records each file in <i>media_objects</i>.",
    "<b>Portal files</b> (exam PDFs, student and staff photos, payment screenshots) are <b>private</b> (Cloudinary authenticated) and reach people only through the site's permission checks.",
    "Uploads use <b>signed, expiring upload links</b>; the browser sends files without cookies, so the link itself is the permission.",
    "Videos over 95 MB upload from the browser straight to Cloudinary in 20 MB pieces, each piece freshly signed. Cloudinary's free plan refuses files over 100 MB; long videos can be YouTube links instead (played through youtube-nocookie.com).",
    "Everything sits under the <b>nwe/</b> folder in the Cloudinary Media Library; deleting or renaming files there breaks the site.",
])
story.append(P("Resend", "h2"))
story += bullets([
    "Sends from the verified domain (EMAIL_FROM, e.g. New World Emerald &lt;noreply@newworldemeraldprivateschool.com&gt;).",
    "Emails: student activation (Student ID + create-password link), account ready (sign-in details), password reset, password changed, admin test email.",
    "Optional: Clerk's staff sign-in emails can be routed through Resend with a signed webhook (/api/webhooks/clerk-email).",
    "/admin \u2192 Email \u2192 <b>Send test email to me</b> shows Resend's exact answer; /admin \u2192 Media storage \u2192 <b>Test connection</b> does the same for Cloudinary.",
])
story.append(PageBreak())

# ---------- 10 ----------
story += section(10, "Security", "Security")
story.append(table([
    ["Protection", "How"],
    ["Fail-closed admin", "Website management addresses are private unless explicitly listed as public."],
    ["Request validation", "Every request is checked against the generated contract; unexpected fields and sizes are refused."],
    ["Headers", "HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Content-Security-Policy (report-only until CSP_ENFORCE=true). No X-Powered-By."],
    ["Audit log", "Staff changes recorded with before/after snapshots and secrets removed; super admins can read it."],
    ["Rate limits", "Student sign-in attempts, password reset requests and public payment screenshot uploads are limited."],
    ["Private files", "Student photos, exam PDFs and payment screenshots are never public; each request is permission-checked."],
    ["Uploads", "File type is checked from the file's own bytes, never the browser's claim; sizes are capped."],
    ["Secrets", "No keys in the public repository (full history scanned on 24 October 2026: clean). Keys only in Render \u2192 Environment."],
    ["Dependencies", "pnpm audit run; patched versions pinned for Express internals and uuid."],
], [36 * mm, CW - 36 * mm]))
story.append(PageBreak())

# ---------- 11 ----------
story += section(11, "Operations", "Hosting, domain and deployment")
story += bullets([
    "<b>Code to live site:</b> push to GitHub \u2192 Render builds the deploy branch (currently <i>chore/hardening-and-tooling</i>) \u2192 <i>scripts/render-build.sh</i> checks key formats, installs with pnpm 10, applies table changes, builds \u2192 the new version replaces the old one with no downtime.",
    "<b>Working branch:</b> <i>portal-upgrade</i>, fast-forwarded into the deploy branch for each release. <i>main</i> is behind; see the checklist.",
    "<b>Domain:</b> Cloudflare DNS. <i>@</i> and <i>www</i> are CNAMEs to the Render service; Clerk's five records (clerk, accounts, clkmail, clk._domainkey, clk2._domainkey) and Resend's records are DNS-only.",
    "<b>Old addresses:</b> WordPress paths (/about-us/, /faqs/, /shop/, /my-account/ and theme pages) redirect to their new places; with FORWARD_TO_DOMAIN=true the onrender.com address forwards to the domain.",
    "<b>Backups:</b> Render PostgreSQL paid plans include daily backups with point-in-time recovery; the free plan has none. Manual copies use <i>pg_dump</i> (commands in DEPLOY-RENDER.md, section 6).",
])
story.append(Spacer(1, 6))
story.append(callout("<b>Never touch</b> the <i>mail</i>, <i>MX</i> or SPF <i>TXT</i> records in Cloudflare, and do not cancel the old hosting plan "
                     "while school email still runs on it. To undo the domain move, put the old A records back."))
story.append(PageBreak())

# ---------- 12 ----------
story += section(12, "Settings", "Settings (environment variables)")
story.append(P("Set in <b>Render \u2192 Environment</b>. Values are never stored in the code. <i>.env.example</i> shows the format."))
story.append(table([
    ["Variable", "Purpose"],
    ["DATABASE_URL", "PostgreSQL connection (Render provides it)."],
    ["CLERK_PUBLISHABLE_KEY, VITE_CLERK_PUBLISHABLE_KEY", "Clerk publishable key (pk_live_\u2026); both must be the same."],
    ["CLERK_SECRET_KEY", "Clerk secret key (sk_live_\u2026)."],
    ["CLERK_WEBHOOK_SIGNING_SECRET", "Optional: verifies Clerk's email webhook (whsec_\u2026)."],
    ["SCHOOL_ADMIN_EMAILS / SCHOOL_SUPER_ADMIN_EMAILS", "Who may manage the website / read the audit log."],
    ["REQUIRE_ADMIN_MFA", "Keep false (Clerk free plan has no production two-factor)."],
    ["CLOUDINARY_URL", "cloudinary://API_KEY:API_SECRET@CLOUD_NAME (the only Cloudinary setting the site reads)."],
    ["RESEND_API_KEY, EMAIL_FROM", "Email sending and sender address."],
    ["PUBLIC_SITE_URL", "https://newworldemeraldprivateschool.com (used in emailed links)."],
    ["FORWARD_TO_DOMAIN", "true: the onrender.com address forwards to the domain."],
    ["CSP_ENFORCE", "true to enforce the Content-Security-Policy (after reviewing reports)."],
    ["FRONTEND_DIST_DIR, NODE_ENV, NODE_VERSION", "Set by the Render blueprint; do not change."],
    ["GCS_SERVICE_ACCOUNT_JSON, PRIVATE_OBJECT_DIR, PUBLIC_OBJECT_SEARCH_PATHS", "Only for the Google Cloud Storage alternative; not used with Cloudinary."],
], [70 * mm, CW - 70 * mm]))
story.append(PageBreak())

# ---------- 13 ----------
story += section(13, "Quality", "Testing and quality")
story.append(P("Results of the full run on 24 October 2026:"))
story.append(table([
    ["Check", "Result"],
    ["Type check, every package", "Pass"],
    ["Screen tests (Vitest)", "134 tests, 20 files, all pass"],
    ["API unit tests", "56 pass"],
    ["Upload and file tests", "14 pass"],
    ["Database suites", "9 suites pass: portal control, report cards, security, accounts, community, media, media storage, school payments, deploy"],
    ["Generated code matches contract", "Pass (codegen produces no changes)"],
    ["Homepage size budget", "208 kB of 220 kB"],
    ["Live site crawl (phone and desktop)", "All pages 200, no script errors, no broken images, no sideways scrolling"],
    ["Security", "Headers present, HTTPS forced, git history free of secrets"],
    ["GitHub Actions CI", "Runs all of the above on every push; passing"],
], [62 * mm, CW - 62 * mm]))
story.append(Spacer(1, 6))
story.append(P("Commands are listed in README.md. Database tests need a throwaway PostgreSQL in DATABASE_URL, <b>never the live database</b>."))
story.append(PageBreak())

# ---------- 14 ----------
story += section(14, "History", "How it was developed")
story.append(table([
    ["When", "Milestone"],
    ["2 to 3 Oct 2026", "Website and backend first built on Replit: public site, admin panel, admissions, store and fees, email sign-in."],
    ["23 Oct 2026", "Moved to a Windows workflow; tooling hardened, CI added, Render deployment prepared; student portal with live exams; report cards; premium redesign of staff tools and student portal."],
    ["23 to 24 Oct", "Phase 1 security (audit log, super admin, sessions, headers); Phase 2 student accounts (automatic IDs, activation links)."],
    ["24 Oct", "Student portal: phone-style home, events calendar, staff directory, gallery, profile photos; /admin redesigned into the app shell."],
    ["24 Oct", "Full site check; homepage spacing, palette and layout polish; Cloudinary media storage; clean build logs."],
    ["24 Oct", "Domain moved from WordPress to this site; Clerk production; Resend email with confirmations; YouTube and 500 MB videos."],
    ["24 Oct", "Handover: README, CI on live branches, prospectus, logo and scroll fixes, bank accounts and payment screenshots, this document."],
], [30 * mm, CW - 30 * mm]))
story.append(Spacer(1, 6))
story.append(P("Method used throughout: explore, plan, agree each phase, build with tests, check in a real browser, commit on a branch, deploy and verify on the live site. The full history (38+ commits) is in GitHub."))
story.append(PageBreak())

# ---------- 15 ----------
story += section(15, "Handover", "Handover checklist")
story.append(P("Transfer ownership", "h2"))
story.append(table([
    ["Account", "Hand over", "Done"],
    ["GitHub repository", "Add the client as owner, or transfer the repository", ""],
    ["Render (web service + database)", "Invite the client to the team, then make them owner", ""],
    ["Cloudflare (DNS)", "Add the client as Super Administrator", ""],
    ["Domain registrar", "Confirm the client owns the domain registration", ""],
    ["Clerk (production instance)", "Transfer the application to the client's organisation", ""],
    ["Cloudinary", "Invite the client as admin, or transfer the account", ""],
    ["Resend", "Invite the client to the team", ""],
    ["Old hosting (school email)", "Confirm the client controls it; keep it paid while email runs there", ""],
], [48 * mm, CW - 64 * mm, 16 * mm], check_last=True))
story.append(P("Security tidy-up", "h2"))
story.append(table([
    ["Action", "Done"],
    ["Rotate every key that was shared during development (database password, Clerk keys, Cloudinary secret, Resend key) and update Render", ""],
    ["Delete unused Render variables (CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME)", ""],
    ["Confirm REQUIRE_ADMIN_MFA is false or removed", ""],
    ["Set SCHOOL_ADMIN_EMAILS / SCHOOL_SUPER_ADMIN_EMAILS to the client's staff and remove the developer", ""],
    ["Remove or reset test accounts (for example test students and teachers)", ""],
    ["Turn on Google 2-Step Verification for every admin email account", ""],
    ["Merge portal-upgrade into main and point Render at main", ""],
], [CW - 16 * mm, 16 * mm], bold_first=False, check_last=True))
story.append(PageBreak())

# ---------- 16 ----------
story += section(16, "Next steps", "Known items and recommended next steps")
story.append(table([
    ["Item", "Status and recommendation"],
    ["Zod security advisory", "One audit finding needs a Zod 4 migration, which breaks generated types today. Risk is low (request bodies are capped at 2 MB, lists have size limits). Plan a dedicated upgrade."],
    ["Content-Security-Policy", "Runs in report-only mode. Review /api/csp-report entries, then set CSP_ENFORCE=true."],
    ["Database backups", "Upgrade Render PostgreSQL to a paid plan for daily backups, or schedule manual pg_dump copies."],
    ["Cloudinary plan", "Free plan: videos up to 100 MB. Upgrade for 500 MB uploads, or keep using YouTube links."],
    ["Clerk plan", "Upgrade if staff two-factor is wanted, then set REQUIRE_ADMIN_MFA=true."],
    ["Planned features", "Attendance and assignments, chat with class teacher and office, notifications, fees per student, library upgrade, CBT question bank and lockdown, import tool, admin and staff user guides."],
    ["Old full portal test", "test:portal relies on Replit object storage and is not run on Render; the database suites cover the same areas."],
], [42 * mm, CW - 42 * mm]))
story.append(Spacer(1, 10))
story.append(callout("<b>Where to start as a new developer:</b> read README.md, then docs/DEPLOY-RENDER.md, run the checks, and make every "
                     "API change contract-first in lib/api-spec. Keep keys out of the code, keep table changes additive, and never touch "
                     "the school email DNS records.", "emerald"))

doc.build(story)
print("written", OUT)
