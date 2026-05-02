"""
Script to populate admin table with two admin accounts.
Run this after database migration to create the admin users.
"""
import asyncio
import sys
from pathlib import Path

# Add the backend directory to the path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database.db import AsyncSessionLocal, engine
from app.database.models import Admin
from app.security import hash_password


async def create_admins():
    """Create admin accounts with hashed passwords"""
    async with AsyncSessionLocal() as db:
        try:
            # Delete all existing admin records
            await db.execute(delete(Admin))
            print("Deleted existing admin records")

            # Hash passwords using the security module
            admin1_password = hash_password("diganthadmin1")
            admin2_password = hash_password("yashadmin2")

            # Create admin accounts
            admin1 = Admin(
                username="admin1",
                password=admin1_password
            )

            admin2 = Admin(
                username="admin2",
                password=admin2_password
            )

            db.add(admin1)
            db.add(admin2)

            await db.commit()

            print("Created admin accounts:")
            print("  - Username: admin1, Password: diganthadmin1")
            print("  - Username: admin2, Password: yashadmin2")
            print("\nAdmin accounts created successfully!")

        except Exception as e:
            await db.rollback()
            print(f"Error creating admin accounts: {e}")
            sys.exit(1)


if __name__ == "__main__":
    print("Creating admin accounts...")
    asyncio.run(create_admins())