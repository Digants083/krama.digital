from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
from typing import Any, Mapping, Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

GREEN = colors.HexColor("#1A5C4A")
DARK = colors.HexColor("#1A1A1A")
MUTED = colors.HexColor("#5A6B65")
PALE_MUTED = colors.HexColor("#8A9A93")
LIGHT_BG = colors.HexColor("#FAFBFA")
LINE = colors.HexColor("#D0D7D3")
GREEN_LINE = colors.HexColor("#B8D5C9")
APPROVED_BG = colors.HexColor("#E2F0E9")
DRAFT_BG = colors.HexColor("#FEF4D6")
DRAFT_TEXT = colors.HexColor("#8A6D00")
RED_TEXT = colors.HexColor("#C0392B")
RED_LIGHT = colors.HexColor("#FEF6F5")
TABLE_HEADER = colors.HexColor("#E8EFEC")

PAGE_W = 178 * mm  # usable width
LABEL_COL = 36 * mm
HALF_COL = 89 * mm


def _register_fonts() -> tuple[str, str]:
    candidates = [
        (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            try:
                pdfmetrics.registerFont(TTFont("PDFRegular", str(regular)))
                pdfmetrics.registerFont(TTFont("PDFBold", str(bold)))
                return "PDFRegular", "PDFBold"
            except Exception:
                continue
    return "Helvetica", "Helvetica-Bold"


def _has(value: Any) -> bool:
    if value is None or value == "":
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, (list, tuple)):
        return any(_has(item) for item in value)
    if isinstance(value, Mapping):
        return any(_has(item) for item in value.values())
    return bool(str(value).strip())


def _txt(value: Any) -> str:
    return str(value).strip() if _has(value) else ""


def _label(key: str) -> str:
    words = key.replace("_", " ").split()
    result = " ".join(w.capitalize() for w in words)
    result = result.replace("Spo2", "SpO2").replace("Bmi", "BMI").replace("Hpi", "HPI")
    return result


def _val_html(value: Any, depth: int = 0) -> str:
    if not _has(value):
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"[a-z0-9]+(?:_[a-z0-9]+)+", text):
            text = text.replace("_", " ").capitalize()
        return escape(text)
    if isinstance(value, (list, tuple)):
        items = [v for v in value if _has(v)]
        if not items:
            return ""
        lines = []
        for item in items:
            rendered = _val_html(item, depth + 1)
            if rendered:
                lines.append(f"\u2022 {rendered}")
        return "<br/>".join(lines)
    if isinstance(value, Mapping):
        # Check for value+unit+source pattern
        if "value" in value and "unit" in value and _has(value.get("value")):
            val = _txt(value.get("value", ""))
            unit = _txt(value.get("unit", ""))
            src = _txt(value.get("source", ""))
            result = f"<b>{escape(val)} {escape(unit)}</b>"
            if src:
                result += f" ({escape(src)})"
            return result
        # systolic/diastolic
        if "systolic" in value or "diastolic" in value:
            sys = _txt(value.get("systolic", "")) or "-"
            dia = _txt(value.get("diastolic", "")) or "-"
            return f"{sys}/{dia}"
        # General object
        lines = []
        for k, v in value.items():
            if not _has(v):
                continue
            rendered = _val_html(v, depth + 1)
            if not rendered:
                continue
            lbl = escape(_label(k))
            if depth < 2:
                lines.append(f"<b>{lbl}:</b><br/>{rendered}")
            else:
                lines.append(f"<b>{lbl}:</b> {rendered}")
        return "<br/>".join(lines)
    return escape(str(value))


def _make_styles(regular_font: str, bold_font: str) -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    return {
        "clinic_name": ParagraphStyle(
            "ClinicName", parent=sample["Heading1"],
            fontName=bold_font, fontSize=16, leading=19,
            textColor=GREEN, spaceAfter=1,
        ),
        "clinic_detail": ParagraphStyle(
            "ClinicDetail", parent=sample["BodyText"],
            fontName=regular_font, fontSize=7.5, leading=10,
            textColor=MUTED,
        ),
        "doc_type": ParagraphStyle(
            "DocType", parent=sample["BodyText"],
            fontName=bold_font, fontSize=7.5, leading=10,
            textColor=GREEN, alignment=TA_RIGHT,
            spaceAfter=1,
        ),
        "doc_id": ParagraphStyle(
            "DocId", parent=sample["BodyText"],
            fontName=regular_font, fontSize=7, leading=9,
            textColor=MUTED, alignment=TA_RIGHT,
        ),
        "status_badge": ParagraphStyle(
            "StatusBadge", parent=sample["BodyText"],
            fontName=bold_font, fontSize=7, leading=9,
            textColor=DARK, alignment=TA_RIGHT,
        ),
        "section_title_sm": ParagraphStyle(
            "SectionTitleSmall", parent=sample["BodyText"],
            fontName=bold_font, fontSize=7, leading=8.5,
            textColor=MUTED, textTransform="uppercase",
        ),
        "info_label": ParagraphStyle(
            "InfoLabel", parent=sample["BodyText"],
            fontName=bold_font, fontSize=7, leading=9,
            textColor=MUTED,
        ),
        "info_value": ParagraphStyle(
            "InfoValue", parent=sample["BodyText"],
            fontName=bold_font, fontSize=8.5, leading=11,
            textColor=DARK,
        ),
        "cs_label": ParagraphStyle(
            "CSLabel", parent=sample["BodyText"],
            fontName=bold_font, fontSize=6.5, leading=8,
            textColor=MUTED, textTransform="uppercase",
        ),
        "cs_value": ParagraphStyle(
            "CSValue", parent=sample["BodyText"],
            fontName=regular_font, fontSize=8, leading=10.5,
            textColor=DARK,
        ),
        "soap_circle": ParagraphStyle(
            "SOAPCircle", parent=sample["BodyText"],
            fontName=bold_font, fontSize=8, leading=10,
            textColor=colors.white, alignment=TA_CENTER,
        ),
        "soap_title": ParagraphStyle(
            "SOAPTitle", parent=sample["BodyText"],
            fontName=bold_font, fontSize=10, leading=12,
            textColor=GREEN,
        ),
        "field_label": ParagraphStyle(
            "FieldLabel", parent=sample["BodyText"],
            fontName=bold_font, fontSize=7, leading=9,
            textColor=MUTED, textTransform="uppercase",
        ),
        "field_value": ParagraphStyle(
            "FieldValue", parent=sample["BodyText"],
            fontName=regular_font, fontSize=8.5, leading=11.5,
            textColor=DARK,
        ),
        "field_missing": ParagraphStyle(
            "FieldMissing", parent=sample["BodyText"],
            fontName=regular_font, fontSize=8, leading=10.5,
            textColor=PALE_MUTED, fontStyle="italic",
        ),
        "table_header": ParagraphStyle(
            "TableHeader", parent=sample["BodyText"],
            fontName=bold_font, fontSize=6.5, leading=8.5,
            textColor=colors.HexColor("#1A3A32"),
        ),
        "table_cell": ParagraphStyle(
            "TableCell", parent=sample["BodyText"],
            fontName=regular_font, fontSize=7.5, leading=10,
            textColor=DARK,
        ),
        "approval_text": ParagraphStyle(
            "ApprovalText", parent=sample["BodyText"],
            fontName=bold_font, fontSize=8.5, leading=11,
            textColor=GREEN,
        ),
        "approval_draft": ParagraphStyle(
            "ApprovalDraft", parent=sample["BodyText"],
            fontName=bold_font, fontSize=8.5, leading=11,
            textColor=DRAFT_TEXT,
        ),
        "footer": ParagraphStyle(
            "Footer", parent=sample["BodyText"],
            fontName=regular_font, fontSize=6.5, leading=8.5,
            textColor=PALE_MUTED,
        ),
        "list_item": ParagraphStyle(
            "ListItem", parent=sample["BodyText"],
            fontName=regular_font, fontSize=8, leading=10.5,
            textColor=DARK, leftIndent=10,
        ),
    }


def _build_header(clinic: Mapping, encounter: Mapping, styles: dict) -> list:
    clinic_name = _txt(clinic.get("name")) or "Clinic"
    address = _txt(clinic.get("address"))
    phone = _txt(clinic.get("phone"))
    email = _txt(clinic.get("email"))
    contact = " | ".join(filter(None, [address, phone, email]))

    left = [
        [Paragraph(escape(clinic_name), styles["clinic_name"])],
        [Paragraph(escape(contact or ""), styles["clinic_detail"])],
    ]
    if not contact:
        left[1][0] = Paragraph("", styles["clinic_detail"])

    is_approved = encounter.get("status") == "approved"
    status_text = "APPROVED" if is_approved else "DRAFT"
    status_bg = APPROVED_BG if is_approved else DRAFT_BG
    status_fg = GREEN if is_approved else DRAFT_TEXT

    right = [
        [Paragraph("ELECTRONIC HEALTH RECORD", styles["doc_type"])],
        [Paragraph(escape(_txt(encounter.get("encounter_id"))), styles["doc_id"])],
        [Paragraph(
            f'<font backcolor="{status_bg.hexval()}"><b>{status_text}</b></font>',
            styles["status_badge"],
        )],
    ]

    header_table = Table(
        [[left, right]],
        colWidths=[PAGE_W * 0.62, PAGE_W * 0.38],
        hAlign="LEFT",
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LINEBELOW", (0, 0), (-1, -1), 2.5, GREEN),
    ]))

    return [header_table, Spacer(1, 4 * mm)]


def _build_patient_info(patient: Mapping, doctor: Mapping, visit: Mapping, clinic: Mapping, styles: dict) -> list:
    doctor_name = _txt(doctor.get("name"))
    if doctor_name:
        doctor_display = f"Dr. {re.sub('^dr[.]? *', '', doctor_name, flags=re.IGNORECASE)}"
    else:
        doctor_display = "Doctor not recorded"

    left_rows = [
        [Paragraph("PATIENT INFORMATION", styles["section_title_sm"])],
    ]
    info_pairs_left = [
        ("Patient name", patient.get("name")),
        ("Patient ID", patient.get("patient_id")),
        ("Phone", patient.get("phone")),
        ("Email", patient.get("email")),
        ("Blood group", patient.get("blood_group")),
    ]
    for label, value in info_pairs_left:
        if not _has(value) and label not in ("Patient name", "Patient ID", "Phone"):
            continue
        label_p = Paragraph(label.upper(), styles["info_label"])
        val = _txt(value) or "\u2014"
        val_p = Paragraph(escape(val), styles["info_value"])
        left_rows.append([label_p, val_p])

    right_rows = [
        [Paragraph("VISIT INFORMATION", styles["section_title_sm"])],
    ]
    info_pairs_right = [
        ("Doctor", doctor_display),
        ("Specialty", doctor.get("specialization")),
        ("Clinic", clinic.get("name")),
        ("Visit date", visit.get("date")),
        ("Visit time", visit.get("time")),
        ("Token", visit.get("appointment_token")),
    ]
    for label, value in info_pairs_right:
        if not _has(value) and label not in ("Doctor", "Clinic", "Visit date"):
            continue
        label_p = Paragraph(label.upper(), styles["info_label"])
        val = _txt(value) or "\u2014"
        val_p = Paragraph(escape(val), styles["info_value"])
        right_rows.append([label_p, val_p])

    left_table = Table(left_rows, colWidths=[28 * mm, 57 * mm])
    right_table = Table(right_rows, colWidths=[28 * mm, 57 * mm])

    for t in (left_table, right_table):
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 1.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ]))

    info_table = Table(
        [[left_table, right_table]],
        colWidths=[HALF_COL, HALF_COL],
        hAlign="LEFT",
    )
    info_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LINEBEFORE", (1, 0), (1, 0), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3.5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))

    return [info_table, Spacer(1, 4 * mm)]


def _build_clinical_summary(ehr_data: Mapping, styles: dict) -> list:
    subjective = ehr_data.get("subjective") or {}
    objective = ehr_data.get("objective") or {}
    assessment = ehr_data.get("assessment") or {}
    plan = ehr_data.get("plan") or {}

    summary_items = [
        ("Chief complaint", subjective.get("chief_complaints")),
        ("HPI", subjective.get("history_of_present_illness")),
        ("Vitals", objective.get("vitals")),
        ("Allergies", subjective.get("allergies")),
        ("Impression", assessment.get("clinical_impression")),
        ("Diagnosis", assessment.get("provisional_diagnoses") or assessment.get("confirmed_diagnoses")),
        ("Medicines", subjective.get("current_medicines")),
        ("Follow-up", plan.get("follow_up")),
    ]
    active = [(label, val) for label, val in summary_items if _has(val)]
    if not active:
        return []

    rows = [[Paragraph("CLINICAL SUMMARY", styles["section_title_sm"])]]
    row = []
    for i, (label, val) in enumerate(active):
        rendered = _val_html(val)
        if len(rendered) > 80:
            rendered = rendered[:80] + "..."
        cell = [
            Paragraph(label.upper(), styles["cs_label"]),
            Paragraph(rendered or "\u2014", styles["cs_value"]),
        ]
        row.append(cell)
        if (i + 1) % 2 == 0 or i == len(active) - 1:
            rows.append(row)
            row = []

    col_count = min(2, len(active))
    col_w = PAGE_W / col_count
    summary_table = Table(rows, colWidths=[col_w] * col_count)
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BG),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.5, GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))

    return [summary_table, Spacer(1, 4 * mm)]


def _section_header(code: Optional[str], title: str, styles: dict) -> list:
    circle = Paragraph(code or "", styles["soap_circle"])
    circle_w = 7 * mm
    circle_table = Table(
        [[circle]],
        colWidths=[circle_w],
        hAlign="LEFT",
    )
    circle_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREEN),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("ROUNDEDCORNERS", (0, 0), (-1, -1), circle_w / 2),
    ]))

    title_p = Paragraph(escape(title), styles["soap_title"])
    heading = Table(
        [[circle_table, title_p]],
        colWidths=[circle_w + 2 * mm, PAGE_W - circle_w - 2 * mm],
        hAlign="LEFT",
    )
    heading.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5),
        ("LINEBELOW", (0, 0), (-1, -1), 1.2, GREEN),
    ]))

    return [heading, Spacer(1, 2.5 * mm)]


def _field_block(label: str, value: Any, styles: dict) -> list:
    if not _has(value):
        return []
    label_p = Paragraph(label.upper(), styles["field_label"])
    rendered = _val_html(value)
    if not rendered:
        return []
    value_p = Paragraph(rendered, styles["field_value"])
    field_table = Table(
        [[label_p], [value_p]],
        colWidths=[PAGE_W],
        hAlign="LEFT",
    )
    field_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
    ]))

    result = [field_table]
    # Try to keep field label with its value
    if len(rendered) < 500:
        return [KeepTogether(result)]
    return result


def _build_vitals_block(vitals: Any, styles: dict) -> list:
    if not _has(vitals):
        return []
    if not isinstance(vitals, Mapping):
        return _field_block("Vitals and measurements", vitals, styles)

    items = [(k, v) for k, v in vitals.items() if _has(v)]
    if not items:
        return []

    rows = [[Paragraph("VITALS AND MEASUREMENTS", styles["section_title_sm"])]]
    row = []
    for i, (key, val) in enumerate(items):
        label = _label(key)
        if isinstance(val, Mapping):
            v = val
            if "value" in v and _has(v.get("value")):
                display = _txt(v.get("value", ""))
                unit = _txt(v.get("unit", ""))
                display_val = f"{display} {unit}".strip()
                source = _txt(v.get("source", ""))
            elif "systolic" in v or "diastolic" in v:
                sys = _txt(v.get("systolic", "")) or "-"
                dia = _txt(v.get("diastolic", "")) or "-"
                display_val = f"{sys}/{dia}"
                source = _txt(v.get("source", ""))
            else:
                display_val = _val_html(val)
                source = ""
        else:
            display_val = str(val)
            source = ""

        cell_content = [
            Paragraph(label.upper(), styles["cs_label"]),
            Paragraph(escape(display_val) or "\u2014", styles["info_value"]),
        ]
        if source:
            cell_content.append(Paragraph(escape(f"({source})"), styles["cs_label"]))
        row.append(cell_content)
        if (i + 1) % 3 == 0 or i == len(items) - 1:
            rows.append(row)
            row = []

    n_cols = min(3, len(items))
    col_w = PAGE_W / n_cols if n_cols > 0 else PAGE_W
    vital_table = Table(rows, colWidths=[col_w] * n_cols)
    vital_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BG),
        ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.5, GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("LINEAFTER", (0, 1), (-1, -1), 0.3, LINE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINE),
    ]))

    return [vital_table, Spacer(1, 1.5 * mm)]


def _build_prescription_table(prescriptions: Any, styles: dict) -> list:
    if not _has(prescriptions):
        return []
    if not isinstance(prescriptions, (list, tuple)):
        return _field_block("Prescriptions", prescriptions, styles)

    items = [p for p in prescriptions if _has(p)]
    if not items:
        return []

    has_details = any(
        isinstance(p, Mapping) and ("dose" in p or "frequency" in p or "strength" in p or "duration" in p)
        for p in items
    )

    if not has_details:
        return _field_block("Prescriptions", prescriptions, styles)

    has_new_fields = any(
        isinstance(p, Mapping) and ("schedule" in p or "meal_timing" in p or "specific_timing" in p)
        for p in items
    )

    if has_new_fields:
        header_row = [
            Paragraph("Medicine", styles["table_header"]),
            Paragraph("Dose", styles["table_header"]),
            Paragraph("Schedule", styles["table_header"]),
            Paragraph("Timing", styles["table_header"]),
            Paragraph("Duration", styles["table_header"]),
            Paragraph("Instructions", styles["table_header"]),
        ]
    else:
        header_row = [
            Paragraph("Medicine", styles["table_header"]),
            Paragraph("Strength", styles["table_header"]),
            Paragraph("Dose", styles["table_header"]),
            Paragraph("Frequency", styles["table_header"]),
            Paragraph("Duration", styles["table_header"]),
            Paragraph("Instructions", styles["table_header"]),
        ]
    data_rows = []
    for item in items:
        if isinstance(item, Mapping):
            o = item
            if has_new_fields:
                schedule = o.get("schedule", {})
                if isinstance(schedule, Mapping):
                    sched_parts = [f"{k}: {v}" for k, v in [("Morn", schedule.get("morning")), ("Aft", schedule.get("afternoon")), ("Night", schedule.get("night"))] if v]
                else:
                    sched_parts = []
                sched_str = "; ".join(sched_parts)
                timing_parts = [str(o.get("meal_timing") or ""), str(o.get("specific_timing") or ""), str(o.get("frequency") or "")]
                timing_parts = [p for p in timing_parts if p]
                if o.get("as_needed"):
                    timing_parts.append("As needed")
                timing_str = "; ".join(timing_parts)
                instr_parts = [str(o.get("indication") or ""), str(o.get("additional_instructions") or "")]
                instr_parts = [p for p in instr_parts if p]
                instr_str = "; ".join(instr_parts)
                data_rows.append([
                    Paragraph(escape(_txt(o.get("medicine_name")) or _txt(o.get("name")) or ""), styles["table_cell"]),
                    Paragraph(escape(_txt(o.get("dose"))), styles["table_cell"]),
                    Paragraph(escape(sched_str), styles["table_cell"]),
                    Paragraph(escape(timing_str), styles["table_cell"]),
                    Paragraph(escape(_txt(o.get("duration"))), styles["table_cell"]),
                    Paragraph(escape(instr_str), styles["table_cell"]),
                ])
            else:
                data_rows.append([
                    Paragraph(escape(_txt(o.get("medicine_name")) or _txt(o.get("name")) or ""), styles["table_cell"]),
                    Paragraph(escape(_txt(o.get("strength"))), styles["table_cell"]),
                    Paragraph(escape(_txt(o.get("dose"))), styles["table_cell"]),
                    Paragraph(escape(_txt(o.get("frequency"))), styles["table_cell"]),
                    Paragraph(escape(_txt(o.get("duration"))), styles["table_cell"]),
                    Paragraph(escape(_txt(o.get("instructions"))), styles["table_cell"]),
                ])
        else:
            data_rows.append([
                Paragraph(escape(str(item)), styles["table_cell"]),
                Paragraph("", styles["table_cell"]),
                Paragraph("", styles["table_cell"]),
                Paragraph("", styles["table_cell"]),
                Paragraph("", styles["table_cell"]),
                Paragraph("", styles["table_cell"]),
            ])

    col_w = PAGE_W / 6
    all_rows = [header_row] + data_rows
    table = LongTable(all_rows, colWidths=[col_w] * 6, hAlign="LEFT", splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
    ]))

    return [table, Spacer(1, 1.5 * mm)]


def _section_fields(code: Optional[str], title: str, fields: list, styles: dict, vitals: bool = False) -> list:
    content = [KeepTogether(_section_header(code, title, styles))]
    content.append(Spacer(1, 1 * mm))

    for label, value in fields:
        if label == "Vitals and measurements":
            blocks = _build_vitals_block(value, styles)
            content.extend(blocks)
        elif label == "Prescriptions":
            blocks = _build_prescription_table(value, styles)
            content.extend(blocks)
        else:
            blocks = _field_block(label, value, styles)
            content.extend(blocks)

    return content


def build_ehr_pdf(
    *,
    encounter: Mapping[str, Any],
    ehr_data: Mapping[str, Any],
    clinic: Mapping[str, Any],
    patient: Mapping[str, Any],
    doctor: Mapping[str, Any],
    visit: Mapping[str, Any],
) -> bytes:
    regular_font, bold_font = _register_fonts()
    styles = _make_styles(regular_font, bold_font)

    clinic_name = _txt(clinic.get("name")) or "Clinic"
    patient_name = _txt(patient.get("name")) or "Patient"

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=16 * mm,
        title=f"EHR - {patient_name}",
        author=clinic_name,
        subject="Electronic Health Record",
    )

    def page_frame(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.3)
        canvas.line(14 * mm, 12 * mm, 196 * mm, 12 * mm)
        canvas.setFont(regular_font, 6)
        canvas.setFillColor(PALE_MUTED)
        canvas.drawString(14 * mm, 9 * mm, f"{clinic_name} | EHR | {patient_name}")
        canvas.drawRightString(196 * mm, 9 * mm, f"Page {doc.page}")
        canvas.restoreState()

    story = []
    story.extend(_build_header(clinic, encounter, styles))
    story.extend(_build_patient_info(patient, doctor, visit, clinic, styles))
    story.extend(_build_clinical_summary(ehr_data, styles))

    is_soap = bool(
        ehr_data.get("schema_version")
        or ehr_data.get("subjective")
        or ehr_data.get("objective")
        or ehr_data.get("assessment")
        or ehr_data.get("plan")
    )

    if is_soap:
        subjective = ehr_data.get("subjective") or {}
        objective = ehr_data.get("objective") or {}
        assessment = ehr_data.get("assessment") or {}
        plan = ehr_data.get("plan") or {}

        soap_sections = [
            ("S", "Subjective \u2014 Patient History", [
                ("Chief complaints", subjective.get("chief_complaints")),
                ("History of present illness", subjective.get("history_of_present_illness")),
                ("Symptoms", subjective.get("symptoms")),
                ("Associated symptoms", subjective.get("associated_symptoms")),
            ]),
            ("O", "Objective \u2014 Clinical Findings", [
                ("Vitals and measurements", objective.get("vitals")),
                ("Examination findings", objective.get("examination_findings")),
                ("Available test results", objective.get("available_test_results")),
            ]),
            ("A", "Assessment \u2014 Clinical Opinion", [
                ("Clinical impression", assessment.get("clinical_impression")),
                ("Provisional diagnoses", assessment.get("provisional_diagnoses")),
                ("Confirmed diagnoses", assessment.get("confirmed_diagnoses")),
                ("Differential diagnoses", assessment.get("differential_diagnoses")),
            ]),
            ("P", "Plan \u2014 Treatment and Follow-up", [
                ("Prescriptions", plan.get("prescriptions")),
                ("Tests ordered", plan.get("tests_ordered")),
                ("Procedures", plan.get("procedures")),
                ("Treatment advice", plan.get("treatment_advice")),
                ("Diet and hydration advice", plan.get("diet_and_hydration_advice")),
                ("Referrals", plan.get("referrals")),
                ("Follow-up", plan.get("follow_up")),
                ("Warning signs", plan.get("warning_signs")),
                ("Other instructions", plan.get("other_instructions")),
            ]),
        ]

        for code, title, fields in soap_sections:
            active = [(label, val) for label, val in fields if _has(val)]
            if not active:
                continue
            story.append(Spacer(1, 2 * mm))
            story.extend(_section_fields(code, title, active, styles))

        # Additional info
        if _has(ehr_data.get("additional_clinical_information")):
            story.append(Spacer(1, 2 * mm))
            story.extend(_section_fields(None, "Additional Clinical Information", [
                ("Additional information", ehr_data.get("additional_clinical_information")),
                ("Private doctor notes", ehr_data.get("private_doctor_notes")),
            ], styles))

    else:
        legacy = [
            (_label(str(k)), v)
            for k, v in ehr_data.items()
            if k not in {"schema_version", "visit_details", "approval", "private_doctor_notes"}
        ]
        if legacy:
            story.append(Spacer(1, 2 * mm))
            for label, value in legacy:
                blocks = _field_block(label, value, styles)
                story.extend(blocks)

    # Approval block
    story.append(Spacer(1, 4 * mm))
    is_approved = encounter.get("status") == "approved"
    doctor_name = _txt(doctor.get("name"))
    if doctor_name:
        doctor_display = f"Dr. {re.sub('^dr[.]? *', '', doctor_name, flags=re.IGNORECASE)}"
    else:
        doctor_display = "Doctor not recorded"

    if is_approved:
        approved_at = encounter.get("approved_at") or ""
        version = "1"
        if _has(ehr_data.get("approval")):
            version = _txt(ehr_data["approval"].get("version")) or "1"
        approval_text = (
            f"Approved by {escape(doctor_display)}."
            f" Approved on {escape(format_date(approved_at))}."
            f" Version {escape(version)}."
        )
        approval_p = Paragraph(approval_text, styles["approval_text"])
    else:
        approval_p = Paragraph(
            "DRAFT \u2014 Awaiting doctor review and approval. This is not a signed final medical record.",
            styles["approval_draft"],
        )

    approval_table = Table(
        [[approval_p]],
        colWidths=[PAGE_W],
        hAlign="LEFT",
    )
    bg_color = APPROVED_BG if is_approved else DRAFT_BG
    approval_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg_color),
        ("BOX", (0, 0), (-1, -1), 0.7, GREEN_LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))

    story.append(approval_table)
    story.append(Spacer(1, 3 * mm))

    # Footer
    encounter_id = _txt(encounter.get("encounter_id"))
    visit_date = _txt(visit.get("date")) or format_date(encounter.get("created_at"))
    status_str = "Approved" if is_approved else "Draft"
    footer_text = (
        f"EHR: {escape(encounter_id)} | Date: {escape(visit_date)}"
        f" | Status: {status_str}"
    )
    footer_p = Paragraph(footer_text, styles["footer"])
    disclaimer_p = Paragraph(
        "This document is part of the patient\u2019s electronic health record.",
        styles["footer"],
    )
    story.extend([footer_p, Paragraph("", styles["footer"]), disclaimer_p])

    document.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    return buffer.getvalue()


def format_date(dt_str: Optional[str]) -> str:
    if not dt_str:
        return "Not recorded"
    try:
        from datetime import datetime
        d = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return d.strftime("%d %b %Y, %I:%M %p").lstrip("0").replace(" 0", " ")
    except (ValueError, TypeError):
        return dt_str or "Not recorded"
