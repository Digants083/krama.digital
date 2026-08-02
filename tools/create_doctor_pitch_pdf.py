from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "pdf"
OUT_DIR.mkdir(parents=True, exist_ok=True)
PDF_PATH = OUT_DIR / "krama_doctor_pitch_and_questions.pdf"

PAGE_W, PAGE_H = A4
MARGIN_X = 18 * mm
MARGIN_Y = 16 * mm

TEAL = colors.HexColor("#0E9384")
DARK = colors.HexColor("#14312D")
NAVY = colors.HexColor("#25435F")
MUTED = colors.HexColor("#5F746F")
LIGHT = colors.HexColor("#EFFAF7")
SOFT = colors.HexColor("#F8FFFD")
AMBER = colors.HexColor("#FFC44F")
CORAL = colors.HexColor("#FF8E72")
LINE = colors.HexColor("#D7EBE7")


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=27,
            leading=32,
            textColor=DARK,
            spaceAfter=8,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=12,
            leading=17,
            textColor=MUTED,
            spaceAfter=12,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=23,
            textColor=DARK,
            spaceBefore=4,
            spaceAfter=9,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            textColor=NAVY,
            spaceBefore=9,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=10.2,
            leading=15,
            textColor=colors.HexColor("#203F3A"),
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.7,
            leading=12,
            textColor=MUTED,
        ),
        "quote": ParagraphStyle(
            "quote",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=19,
            textColor=DARK,
            leftIndent=10,
            rightIndent=10,
            spaceAfter=8,
        ),
        "center": ParagraphStyle(
            "center",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=15,
            textColor=DARK,
            alignment=TA_CENTER,
        ),
        "table": ParagraphStyle(
            "table",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.6,
            leading=11.2,
            textColor=colors.HexColor("#203F3A"),
        ),
        "table_bold": ParagraphStyle(
            "table_bold",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8.8,
            leading=11.2,
            textColor=DARK,
        ),
    }


S = styles()


def p(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, S[style])


def bullet(items: list[str]) -> ListFlowable:
    return ListFlowable(
        [ListItem(p(item), leftIndent=8) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=14,
        bulletFontName="Helvetica-Bold",
        bulletColor=TEAL,
    )


def numbered(items: list[str]) -> ListFlowable:
    return ListFlowable(
        [ListItem(p(item), leftIndent=10) for item in items],
        bulletType="1",
        leftIndent=16,
        bulletFontName="Helvetica-Bold",
        bulletColor=TEAL,
    )


def card(title: str, body: str, color=LIGHT):
    data = [[p(title, "table_bold")], [p(body, "table")]]
    t = Table(data, colWidths=[PAGE_W - 2 * MARGIN_X - 8 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), color),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return t


def simple_table(headers: list[str], rows: list[list[str]], widths: list[float]):
    data = [[p(h, "table_bold") for h in headers]]
    for row in rows:
        data.append([p(cell, "table") for cell in row])
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
                ("TEXTCOLOR", (0, 0), (-1, 0), DARK),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def draw_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(SOFT)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.roundRect(MARGIN_X, PAGE_H - 12 * mm, 26 * mm, 4 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setFillColor(AMBER)
    canvas.roundRect(MARGIN_X + 30 * mm, PAGE_H - 12 * mm, 19 * mm, 4 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN_X, 13 * mm, PAGE_W - MARGIN_X, 13 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, 8 * mm, "Krama doctor pitch guide")
    canvas.drawRightString(PAGE_W - MARGIN_X, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_story():
    story = []
    logo_path = ROOT / "public" / "krama-logo.png"

    if logo_path.exists():
        img = Image(str(logo_path), width=24 * mm, height=24 * mm)
        story.append(img)
        story.append(Spacer(1, 5))

    story.append(p("Krama Doctor Pitch Guide", "title"))
    story.append(p("A practical pitch, AI discussion points, pilot exercise plan, and questions to ask before onboarding a clinic.", "subtitle"))
    story.append(card("Core positioning", "Krama helps clinics reduce waiting-room confusion by bringing queue control, appointments, delay updates, billing, reminders, and revisit follow-ups into one connected workflow."))
    story.append(Spacer(1, 10))
    story.append(p("30-second opening pitch", "h1"))
    story.append(p(
        "\"Doctor, in most clinics the biggest patient complaint is not always treatment quality - it is waiting without clarity. A patient may book an appointment, reach on time, and still wait because walk-ins, delays, tokens, billing, and follow-ups are handled separately. Krama is built to solve that daily operational problem. It gives the clinic a live queue, patient token status, delay updates, appointment scheduling, billing support, and revisit reminders - so staff get control, patients get clarity, and the doctor gets a smoother clinic flow.\"",
        "quote",
    ))
    story.append(p("What to say next", "h1"))
    story.append(numbered([
        "Start with the doctor's pain: waiting room pressure, repeated patient questions, staff overload, delay communication, and missed revisits.",
        "Position Krama as an operational layer, not a replacement for the doctor or existing clinical judgment.",
        "Show that the first goal is simple: organize the front desk and patient flow before adding deeper AI or EMR features.",
        "Ask permission to study their clinic workflow and run a small pilot with measurable outcomes.",
    ]))
    story.append(PageBreak())

    story.append(p("The Doctor-Facing Pitch", "h1"))
    story.append(p("Problem", "h2"))
    story.append(bullet([
        "Patients often wait without knowing their real turn, even after booking an appointment.",
        "Reception staff handle walk-ins, appointments, calls, doctor delays, billing, and follow-ups manually.",
        "Doctors lose time when the queue is not ready, patients are irritated, or records are scattered.",
        "Clinics may lose revisit revenue because follow-ups are not reminded or tracked properly.",
    ]))
    story.append(p("Solution", "h2"))
    story.append(p("Krama creates one clinic flow: appointment booking, walk-in token, live queue, doctor time management, delay updates, billing, reminders, and revisit tracking."))
    story.append(p("Why it matters to the doctor", "h2"))
    story.append(simple_table(
        ["Doctor concern", "Krama response"],
        [
            ["Patients keep asking when their turn will come.", "Patients can see token status, queue position, and expected consultation time."],
            ["Doctor gets delayed and staff must explain repeatedly.", "Delay can be updated once and communicated through the queue flow."],
            ["Walk-ins and appointments mix badly.", "Queue control separates and organizes both flows."],
            ["Billing slows down the exit process.", "Billing is connected to the patient visit flow."],
            ["Revisits are missed.", "Reminder and revisit follow-up prompts help bring patients back."],
        ],
        [55 * mm, 105 * mm],
    ))
    story.append(Spacer(1, 8))
    story.append(card("Simple close", "We are not asking you to change your medical practice. We want to make the clinic flow around your practice calmer, more predictable, and easier to manage."))
    story.append(PageBreak())

    story.append(p("How To Explain The AI Angle", "h1"))
    story.append(p("Keep this honest and practical. Do not oversell AI as diagnosis. For doctors, the safest pitch is AI for operations first.", "body"))
    story.append(simple_table(
        ["AI area", "How it helps clinic", "How to say it"],
        [
            ["Queue prediction", "Learns average consultation time and improves estimated wait time.", "\"AI can help predict a more realistic ETA instead of showing a blind token number.\""],
            ["Delay intelligence", "Understands when a doctor or slot is running late and updates the expected flow.", "\"If the clinic is delayed, patients should know early instead of asking the front desk again and again.\""],
            ["Revisit reminders", "Identifies due follow-ups and helps staff remind patients.", "\"This helps protect patient continuity and clinic revisit revenue.\""],
            ["Operational insights", "Shows busy hours, bottlenecks, no-shows, and service-time patterns.", "\"The clinic gets data to improve flow without guessing.\""],
            ["Future clinical support", "Possible future integration with EMR/EHR summaries, with doctor approval.", "\"We will not automate medical decisions. Any clinical AI should support the doctor, not replace the doctor.\""],
        ],
        [31 * mm, 61 * mm, 68 * mm],
    ))
    story.append(Spacer(1, 9))
    story.append(card("Important line to use", "Krama's first AI focus is clinic operations: wait-time prediction, delay management, revisit reminders, and workflow insights. Diagnosis and treatment decisions stay with the doctor."))
    story.append(p("Questions to ask about AI", "h2"))
    story.append(numbered([
        "Would realistic wait-time prediction be useful for your patients?",
        "What delay information would you want patients to see, and what should stay internal?",
        "Should AI reminders be automatic, or should staff approve them first?",
        "What clinic reports would help you most: peak hours, average consultation time, no-shows, revisits, or billing patterns?",
    ]))
    story.append(PageBreak())

    story.append(p("Pilot Exercise Plan", "h1"))
    story.append(p("Pitch this as a low-risk clinic workflow exercise. The goal is to prove value before asking for deep adoption.", "body"))
    story.append(simple_table(
        ["Step", "What we do", "Doctor/clinic effort"],
        [
            ["1. Observe", "Spend 1-2 clinic sessions understanding current patient flow, token handling, delays, billing, and follow-ups.", "Allow observation and explain current process."],
            ["2. Map", "Create a simple workflow map: appointment, walk-in, waiting, consultation, billing, revisit.", "Review and correct the map."],
            ["3. Configure", "Set up doctors, time slots, queue categories, delay rules, and basic billing/revisit flow.", "Provide basic clinic details."],
            ["4. Parallel run", "Run Krama alongside the existing process for a few days without disrupting clinic work.", "Staff try queue and token flow."],
            ["5. Measure", "Compare waiting-time clarity, front-desk questions, missed revisits, no-shows, and billing speed.", "Share feedback."],
            ["6. Decide", "If useful, move from pilot to regular use with staff training.", "Approve next rollout."],
        ],
        [22 * mm, 85 * mm, 53 * mm],
    ))
    story.append(Spacer(1, 8))
    story.append(p("Pilot success metrics", "h2"))
    story.append(bullet([
        "Fewer repeated patient questions at reception.",
        "Clearer queue order for appointments and walk-ins.",
        "Patients receive better ETA and delay communication.",
        "Staff can call next patient faster.",
        "Revisit reminders are tracked instead of forgotten.",
        "Doctor feels the waiting room is calmer and more predictable.",
    ]))
    story.append(PageBreak())

    story.append(p("EHR / EMR Discussion", "h1"))
    story.append(p("Doctors may ask about EHR or EMR. Be clear: Krama can start as queue and clinic-flow software, then integrate or expand toward records carefully.", "body"))
    story.append(simple_table(
        ["Term", "Simple meaning", "How Krama should approach it"],
        [
            ["EMR", "Electronic Medical Record within one clinic or practice.", "Krama can attach visit notes, billing, revisit history, and patient visit timeline if the doctor wants."],
            ["EHR", "Broader health record that may move across providers or systems.", "Krama should support future integrations carefully, with consent, privacy, and compliance in mind."],
            ["Integration", "Connecting Krama to existing software.", "Ask what the clinic already uses before proposing replacement."],
            ["Privacy", "Patient medical data is sensitive.", "Collect only what is needed, restrict access by role, and get consent for patient communication."],
        ],
        [26 * mm, 62 * mm, 72 * mm],
    ))
    story.append(p("Questions to ask about EHR/EMR", "h2"))
    story.append(numbered([
        "Do you currently use paper records, Excel, WhatsApp, clinic software, EMR, or hospital software?",
        "What patient data do you want Krama to store at the start: only queue and appointment data, or also visit notes and reports?",
        "Who should access patient records: doctor only, front desk, billing staff, or assistants?",
        "Do you need prescription, lab report, or patient-history support now, or should we keep phase one focused on queue and operations?",
        "Would integration with your current EMR/EHR be needed later?",
    ]))
    story.append(PageBreak())

    story.append(p("Questions To Ask The Doctor", "h1"))
    story.append(p("Use these after the pitch. The goal is to learn their real workflow and make them feel Krama is being shaped around their clinic.", "body"))
    story.append(p("Clinic workflow", "h2"))
    story.append(numbered([
        "How do you currently manage appointments and walk-in patients?",
        "At what time does the waiting room become most crowded?",
        "How many patients do you see on a normal day and on a busy day?",
        "How does your staff decide who goes next?",
        "What usually causes delays in your clinic?",
    ]))
    story.append(p("Patient communication", "h2"))
    story.append(numbered([
        "What do patients ask your reception staff most often?",
        "Would patients prefer SMS, WhatsApp, app notification, or display screen updates?",
        "Should patients see exact waiting time or a safe time range?",
        "How do you currently inform patients when the doctor is delayed?",
    ]))
    story.append(p("Business and operations", "h2"))
    story.append(numbered([
        "How do you currently handle billing?",
        "Do you track missed revisits or follow-ups?",
        "What reports would help you run the clinic better?",
        "Who in your clinic would use the software every day?",
        "What would make you feel the pilot is successful?",
    ]))
    story.append(PageBreak())

    story.append(p("Questions You Should Not Miss", "h1"))
    story.append(simple_table(
        ["Question", "Why it matters"],
        [
            ["What is the biggest pain point: queue, appointments, billing, follow-up, or records?", "Helps you pitch the feature they care about most."],
            ["What should not change in your current workflow?", "Prevents you from sounding like you will disrupt the clinic."],
            ["Who is the decision maker for software purchase?", "Doctor may like it, but admin/owner may approve payment."],
            ["What is your current monthly spend on clinic software or manual staff effort?", "Helps pricing later."],
            ["Would you prefer a free pilot, paid pilot, or demo first?", "Moves the conversation toward action."],
            ["Can we observe one clinic session to measure the actual queue flow?", "Gets permission for the pilot exercise."],
            ["What patient data are you comfortable digitizing first?", "Important for trust, privacy, and EMR/EHR scope."],
            ["What would stop you from adopting Krama?", "Surfaces objections early."],
        ],
        [66 * mm, 94 * mm],
    ))
    story.append(Spacer(1, 10))
    story.append(card("Final ask", "Doctor, if you are open to it, can we run a small pilot in your clinic for a few days, measure the queue flow, and show you whether Krama reduces confusion for your staff and patients?"))
    story.append(p("Meeting close checklist", "h2"))
    story.append(bullet([
        "Ask for permission to observe one clinic session.",
        "Ask who from the clinic team should join the pilot discussion.",
        "Ask for current queue/appointment/billing process details.",
        "Confirm whether they want phase one as queue-only or queue plus billing/reminders.",
        "Fix the next meeting date before leaving.",
    ]))

    return story


def main():
    frame = Frame(MARGIN_X, MARGIN_Y, PAGE_W - 2 * MARGIN_X, PAGE_H - 2 * MARGIN_Y, id="normal")
    doc = BaseDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_Y,
        bottomMargin=MARGIN_Y,
        title="Krama Doctor Pitch Guide",
        author="Krama",
    )
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=draw_page)])
    doc.build(build_story())
    print(PDF_PATH)


if __name__ == "__main__":
    main()
