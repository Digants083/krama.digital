import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.routers.admin import (
    AdminDataUnlockRequest,
    _build_learning_changes,
    create_admin_data_token,
    require_admin_data_session,
    unlock_admin_data,
)


class AdminDataSecurityTests(unittest.IsolatedAsyncioTestCase):
    def test_learning_diff_reports_clinical_edits_but_not_approval_metadata(self):
        generated = {
            "assessment": {"provisional_diagnosis": ["Viral fever"]},
            "plan": {"warning_signs": []},
            "approval": {"status": "draft", "approved_at": None},
        }
        approved = {
            "assessment": {"provisional_diagnosis": ["Viral infection"]},
            "plan": {"warning_signs": ["Breathing difficulty"]},
            "approval": {"status": "approved", "approved_at": "2026-08-02"},
        }

        changes = _build_learning_changes(generated, approved)

        changed_fields = {change["field"] for change in changes}
        self.assertIn("assessment.provisional_diagnosis[0]", changed_fields)
        self.assertIn("plan.warning_signs[0]", changed_fields)
        self.assertFalse(any(field.startswith("approval") for field in changed_fields))

    async def test_password_unlock_returns_short_lived_token(self):
        admin_session = {"admin_id": "1", "username": "admin1"}
        with patch("app.routers.admin.auth_token_secret", return_value="test-secret"):
            response = await unlock_admin_data(
                AdminDataUnlockRequest(password="Krama@1admin"),
                admin_session,
            )
        self.assertTrue(response["data_token"])
        self.assertTrue(response["expires_at"])

    async def test_incorrect_password_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            await unlock_admin_data(
                AdminDataUnlockRequest(password="incorrect"),
                {"admin_id": "1", "username": "admin1"},
            )
        self.assertEqual(raised.exception.status_code, 403)

    async def test_data_token_is_bound_to_the_admin_session(self):
        first_admin = {"admin_id": "1", "username": "admin1"}
        second_admin = {"admin_id": "2", "username": "admin2"}
        with patch("app.routers.admin.auth_token_secret", return_value="test-secret"):
            token, _expires_at = create_admin_data_token(first_admin)
            resolved = await require_admin_data_session(token, first_admin)
            self.assertEqual(resolved, first_admin)
            with self.assertRaises(HTTPException) as raised:
                await require_admin_data_session(token, second_admin)
        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
