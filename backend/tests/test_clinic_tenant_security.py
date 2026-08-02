import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.security import (
    ClinicPrincipal,
    create_clinic_access_token,
    require_clinic_principal,
    require_matching_clinic,
)


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _FakeDb:
    def __init__(self, clinic):
        self.clinic = clinic

    async def execute(self, _query):
        return _ScalarResult(self.clinic)


class ClinicTenantSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_signed_token_resolves_its_clinic(self):
        clinic = SimpleNamespace(
            clinic_id="CLINIC-A",
            email="clinic-a@example.com",
            password="$2b$12$stored-password-hash",
        )
        token = create_clinic_access_token(clinic.clinic_id, clinic.password)

        principal = await require_clinic_principal(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=token),
            _FakeDb(clinic),
        )

        self.assertEqual(principal.clinic_id, "CLINIC-A")

    async def test_token_signed_for_another_password_is_rejected(self):
        clinic = SimpleNamespace(
            clinic_id="CLINIC-A",
            email="clinic-a@example.com",
            password="$2b$12$current-password-hash",
        )
        token = create_clinic_access_token(clinic.clinic_id, "$2b$12$old-password-hash")

        with self.assertRaises(HTTPException) as raised:
            await require_clinic_principal(
                HTTPAuthorizationCredentials(scheme="Bearer", credentials=token),
                _FakeDb(clinic),
            )

        self.assertEqual(raised.exception.status_code, 401)

    def test_cross_clinic_id_is_rejected(self):
        principal = ClinicPrincipal(clinic_id="CLINIC-A", email="clinic-a@example.com")

        with self.assertRaises(HTTPException) as raised:
            require_matching_clinic(principal, "CLINIC-B")

        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
