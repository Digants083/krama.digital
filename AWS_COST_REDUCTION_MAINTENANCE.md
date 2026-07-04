# AWS Cost Reduction Maintenance Plan

This audit is based on the current Krama codebase. The main conclusion: the code can create some background database work, but the monthly cost of about USD 30-35 with almost no users is much more likely coming from always-on AWS infrastructure: EC2, RDS, storage, backups, public IPv4, and data transfer.

## Current App Shape

- Frontend: React/Vite static app, already configured for Netlify in `netlify.toml`.
- Backend: FastAPI running with Uvicorn.
- Database: PostgreSQL through `DATABASE_URL`, likely AWS RDS in production.
- Realtime: Server-Sent Events through `/api/realtime/queue-events`.
- Background jobs: enabled by default unless `BACKGROUND_JOBS_ENABLED=false`.

## Codebase Findings That Affect Load

### 1. Backend background jobs are always enabled by default

Files:
- `backend/app/config.py`
- `backend/app/main.py`
- `backend/app/services/delay_jobs.py`

Current defaults:

```env
BACKGROUND_JOBS_ENABLED=true
SCHEDULER_ACTIVE_POLL_SECONDS=60
SCHEDULER_IDLE_POLL_SECONDS=300
```

What it does:
- Auto-stops active clinics every 60 seconds when clinics are live.
- Polls every 300 seconds when no clinics are live.
- Runs midnight appointment cleanup.
- Starts a placeholder delay job that sleeps for one hour repeatedly.

Cost impact:
- Low to moderate database activity.
- Not enough by itself to explain USD 30-35/month.
- Can keep backend and database constantly warm.

Recommended low-user setting:

```env
BACKGROUND_JOBS_ENABLED=true
SCHEDULER_ACTIVE_POLL_SECONDS=120
SCHEDULER_IDLE_POLL_SECONDS=900
```

If there are no real clinics using the app yet:

```env
BACKGROUND_JOBS_ENABLED=false
```

Only use `false` when you are okay with auto-stop and automatic cleanup not running.

### 2. Startup runs many database schema checks/migrations

File:
- `backend/app/main.py`

The app runs `Base.metadata.create_all`, many `ALTER TABLE IF NOT EXISTS`, many `CREATE INDEX IF NOT EXISTS`, and admin table recreation on startup.

Cost impact:
- Mostly startup-only cost.
- Can slow down restarts.
- Not the main monthly bill driver.

Maintenance recommendation:
- Keep this during early development.
- Later, move startup schema changes into Alembic migrations and stop running DDL on every boot.
- Do not repeatedly restart the EC2 service unless needed.

Important risk:
- `backend/app/main.py` drops and recreates the `admins` table on every backend startup. That is more of a data-risk issue than a cost issue.

### 3. Database connection pool is not tuned for tiny traffic

File:
- `backend/app/database/db.py`

The engine uses SQLAlchemy defaults:

```python
create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
```

Cost impact:
- RDS cost is fixed while it is running, but extra connections can increase memory usage on small instances.

Recommended code/env improvement:

```python
create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=1,
    max_overflow=2,
    pool_recycle=1800,
)
```

This keeps the app structure the same and is better for very low traffic.

### 4. Frontend live screens poll when open

Files:
- `src/pages/ClinicControlQueue.tsx`
- `src/pages/DoctorDashboard.tsx`
- `src/pages/AppointmentConfirmation.tsx`
- `src/pages/PatientDashboard.tsx`
- `src/pages/TrackQueue.tsx`
- `src/hooks/useQueueRealtime.ts`

Observed intervals:
- Clinic queue refresh: 15 seconds when the clinic queue screen is open.
- Doctor dashboard refresh: 10 seconds when a doctor has selected a profile/session.
- Active status refresh: 60 seconds.
- Patient tracking refresh: 5 minutes.
- SSE heartbeat: 20 seconds per open realtime connection.

Cost impact:
- Only matters when users leave these pages open.
- Does not explain cost if nobody is using the app.

Low-user maintenance option:
- Increase clinic queue fallback polling from 15 seconds to 60 seconds.
- Increase doctor dashboard fallback polling from 10 seconds to 60 seconds.
- Keep SSE realtime events as the primary live update path.

### 5. Images and PDFs are stored in PostgreSQL

Files:
- `backend/app/database/models.py`
- `backend/app/routers/auth.py`
- `backend/app/routers/patient_reports.py`

Observed storage:
- Clinic images are base64 in a JSON column.
- Report PDFs are stored in `BYTEA` columns.

Cost impact:
- Can increase RDS storage and backup size.
- Probably not a big cost yet if there are only a few users.

Maintenance recommendation:
- For production, store images/PDFs in S3 or another object store and keep only URLs/metadata in Postgres.
- Until you have real clinics, delete unused test uploads and old reports.

## AWS Cost Drivers To Check First

Open AWS Billing and Cost Explorer and check service breakdown for the last 30 days. Focus on:

- Amazon RDS
- Amazon EC2
- EBS volumes
- Public IPv4 address
- NAT Gateway, if any
- Load Balancer, if any
- Snapshots and backups
- CloudWatch logs

Most likely monthly baseline:

- EC2 instance running 24/7.
- RDS instance running 24/7.
- RDS storage and backups.
- EBS root volume.
- Public IPv4 charge.

The codebase cannot remove most of that fixed baseline. Even if there are zero users, AWS still charges for always-on EC2/RDS.

## Cheapest Same-Structure Plan

This keeps the same app structure: React frontend, FastAPI backend, PostgreSQL database.

### Option A: Keep AWS, remove RDS

Best if you want the smallest change while staying on AWS.

1. Keep frontend on Netlify.
2. Keep backend on one small EC2 instance.
3. Install PostgreSQL on the same EC2 instance.
4. Move data from RDS to local PostgreSQL.
5. Change `DATABASE_URL` to point to local Postgres:

```env
DATABASE_URL=postgresql+asyncpg://krama_user:strong_password@127.0.0.1:5432/krama
```

6. Stop RDS after verifying the app works.
7. Delete RDS only after you have a confirmed backup.

Expected result:
- Removes most RDS monthly cost.
- Keeps backend/database architecture almost the same.

Risk:
- EC2 failure can affect both app and database.
- You must configure backups.

Minimum backup habit:

```bash
pg_dump krama > krama_backup_YYYY-MM-DD.sql
```

### Option B: Keep RDS but reduce idle work

Best if you want safer managed database hosting.

1. Use the smallest suitable RDS PostgreSQL instance.
2. Disable Multi-AZ unless you truly need it.
3. Reduce backup retention while pre-launch.
4. Keep storage small and disable unnecessary autoscaling.
5. Tune backend pool size to 1-2 connections.
6. Increase scheduler idle interval to 900 seconds.

Expected result:
- Smaller improvement.
- RDS still has a fixed monthly cost.

### Option C: Move DB to a low-cost Postgres provider

Best while there are no paying clinics yet.

1. Keep frontend on Netlify.
2. Keep backend on EC2 or a cheap app host.
3. Move Postgres to a low-cost managed Postgres provider.
4. Update only `DATABASE_URL`.

Expected result:
- Same code structure.
- Much lower idle database cost.

## Immediate Maintenance Checklist

Do these first:

1. In AWS Cost Explorer, confirm the top billed services.
2. If RDS is the biggest cost, snapshot/export it before changes.
3. If no real clinics are using the app, temporarily stop RDS and EC2 when not testing.
4. Check for unattached EBS volumes and old snapshots.
5. Check for unused Elastic IP/public IPv4 charges.
6. Check that there is no NAT Gateway or Load Balancer left running.
7. Set an AWS Budget alert at USD 5, USD 10, and USD 20.
8. Set backend env:

```env
SCHEDULER_ACTIVE_POLL_SECONDS=120
SCHEDULER_IDLE_POLL_SECONDS=900
```

9. Consider DB pool tuning in `backend/app/database/db.py`.
10. Do not delete RDS until the app is confirmed working from a backup or migrated database.

## What Not To Blame First

- The frontend static app is not the main cost driver.
- The SSE heartbeat is not the main cost driver unless many tabs stay open.
- The background jobs are not likely to create USD 30-35/month by themselves.
- Low user traffic does not reduce EC2/RDS bills when those services run 24/7.

## Practical Recommendation For Krama Right Now

Because the app has almost no users and no clients yet, the best cost move is:

1. Keep the frontend on Netlify.
2. Keep the FastAPI backend as-is.
3. Remove RDS from the pre-client setup by moving Postgres to the same EC2 instance or a low-cost managed Postgres.
4. Tune backend idle jobs and DB pool.
5. Add proper backups before deleting anything.

This should preserve the current app structure while reducing the fixed monthly AWS bill.
