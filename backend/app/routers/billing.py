from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.db import get_db
from app.database.models import Billing, Clinic

router = APIRouter(prefix="/billing", tags=["billing"])


class BillingTemplatePayload(BaseModel):
    clinic_id: str
    clinic_name: str = "Clinic"
    clinic_address: Optional[str] = None
    doctor_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    template_title: str = "Clinic Bill"
    footer_note: Optional[str] = None
    signature_text: Optional[str] = None
    signature_image: Optional[str] = None


class BillingServicePayload(BaseModel):
    clinic_id: str
    name: str
    price: int = Field(ge=0)
    active: bool = True


class BillingServiceUpdatePayload(BaseModel):
    clinic_id: str
    name: Optional[str] = None
    price: Optional[int] = Field(default=None, ge=0)
    active: Optional[bool] = None


class BillingItemPayload(BaseModel):
    name: str
    price: int = Field(ge=0)
    quantity: int = Field(default=1, ge=1)


class CreateBillPayload(BaseModel):
    clinic_id: str
    appointment_id: Optional[int] = None
    patient_name: str
    patient_phone: Optional[str] = None
    token: Optional[str] = None
    bill_source: str = "manual"
    items: List[BillingItemPayload]
    payment_mode: str = "Cash"
    payment_status: str = "paid"


def _row_to_bill(row: Billing) -> Dict[str, Any]:
    return {
        "id": row.id,
        "bill_id": row.bill_id,
        "clinic_id": row.clinic_id,
        "appointment_id": row.appointment_id,
        "patient_name": row.patient_name,
        "patient_phone": row.patient_phone,
        "token": row.token,
        "bill_source": row.bill_source,
        "items": row.items or [],
        "total_amount": row.total_amount or 0,
        "payment_mode": row.payment_mode,
        "payment_status": row.payment_status,
        "template": row.template or {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _model_data(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _default_services() -> List[Dict[str, Any]]:
    return [{"id": "consultation", "name": "Consultation", "price": 500, "active": True}]


async def _clinic_defaults(db: AsyncSession, clinic_id: str) -> Dict[str, Any]:
    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))
    clinic = result.scalar_one_or_none()
    if not clinic:
        return {
            "clinic_name": "Clinic",
            "clinic_address": "",
            "doctor_name": "",
            "contact_phone": "",
            "contact_email": "",
            "template_title": "Clinic Bill",
            "footer_note": "Thank you for visiting.",
            "signature_text": "",
            "signature_image": "",
        }

    address_parts = [
        clinic.street_address,
        clinic.road,
        clinic.layout,
        clinic.section,
        clinic.city,
        clinic.pincode,
    ]
    return {
        "clinic_name": clinic.clinic_name or "Clinic",
        "clinic_address": ", ".join(part for part in address_parts if part) or clinic.address or "",
        "doctor_name": clinic.doctor_name or "",
        "contact_phone": clinic.phone or "",
        "contact_email": clinic.email or "",
        "template_title": "Clinic Bill",
        "footer_note": "Thank you for visiting.",
        "signature_text": "",
        "signature_image": "",
    }


async def _settings_row(db: AsyncSession, clinic_id: str) -> Billing:
    result = await db.execute(
        select(Billing)
        .where(Billing.clinic_id == clinic_id, Billing.record_type == "settings")
        .order_by(Billing.id.asc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row:
        return row

    row = Billing(
        clinic_id=clinic_id,
        record_type="settings",
        template=await _clinic_defaults(db, clinic_id),
        services=_default_services(),
        items=[],
        total_amount=0,
        payment_status="settings",
    )
    db.add(row)
    await db.flush()
    return row


@router.get("/template")
async def get_billing_template(clinic_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    row = await _settings_row(db, clinic_id)
    template = {**(await _clinic_defaults(db, clinic_id)), **(row.template or {})}
    await db.commit()
    return template


@router.put("/template")
async def update_billing_template(payload: BillingTemplatePayload, db: AsyncSession = Depends(get_db)):
    row = await _settings_row(db, payload.clinic_id)
    row.template = _model_data(payload)
    await db.commit()
    await db.refresh(row)
    return row.template or {}


@router.get("/services")
async def get_billing_services(clinic_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    row = await _settings_row(db, clinic_id)
    services = row.services or _default_services()
    await db.commit()
    return services


@router.post("/services", status_code=status.HTTP_201_CREATED)
async def create_billing_service(payload: BillingServicePayload, db: AsyncSession = Depends(get_db)):
    row = await _settings_row(db, payload.clinic_id)
    service_name = payload.name.strip()
    if not service_name:
        raise HTTPException(status_code=400, detail="Service name is required")

    service = {
        "id": f"svc-{uuid4().hex[:10]}",
        "name": service_name,
        "price": payload.price,
        "active": payload.active,
    }
    row.services = [*(row.services or []), service]
    await db.commit()
    return service


@router.put("/services/{service_id}")
async def update_billing_service(service_id: str, payload: BillingServiceUpdatePayload, db: AsyncSession = Depends(get_db)):
    row = await _settings_row(db, payload.clinic_id)
    services = list(row.services or [])
    for service in services:
        if str(service.get("id")) != service_id:
            continue
        if payload.name is not None:
            service["name"] = payload.name.strip()
        if payload.price is not None:
            service["price"] = payload.price
        if payload.active is not None:
            service["active"] = payload.active
        row.services = services
        await db.commit()
        return service
    raise HTTPException(status_code=404, detail="Service not found")


@router.delete("/services/{service_id}")
async def delete_billing_service(service_id: str, clinic_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    row = await _settings_row(db, clinic_id)
    row.services = [service for service in list(row.services or []) if str(service.get("id")) != service_id]
    await db.commit()
    return {"ok": True}


@router.get("/bills")
async def get_billing_history(clinic_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Billing)
        .where(Billing.clinic_id == clinic_id, Billing.record_type == "bill")
        .order_by(desc(Billing.created_at))
        .limit(500)
    )
    return [_row_to_bill(row) for row in result.scalars().all()]


@router.post("/bills", status_code=status.HTTP_201_CREATED)
async def create_bill(payload: CreateBillPayload, db: AsyncSession = Depends(get_db)):
    items = [_model_data(item) for item in payload.items if item.name.strip()]
    if not items:
        raise HTTPException(status_code=400, detail="At least one billing item is required")

    settings = await _settings_row(db, payload.clinic_id)
    template_snapshot = {
        **(await _clinic_defaults(db, payload.clinic_id)),
        **(settings.template or {}),
    }

    row = Billing(
        clinic_id=payload.clinic_id,
        record_type="bill",
        bill_id=f"BILL-{datetime.utcnow().strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}",
        appointment_id=payload.appointment_id,
        patient_name=payload.patient_name.strip(),
        patient_phone=payload.patient_phone,
        token=payload.token,
        bill_source=payload.bill_source,
        items=items,
        total_amount=sum(item["price"] * item["quantity"] for item in items),
        payment_mode=payload.payment_mode,
        payment_status=payload.payment_status,
        template=template_snapshot,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_bill(row)
