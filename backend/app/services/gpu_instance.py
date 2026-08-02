"""Lifecycle controller for the private GPU EC2 instance hosting Ollama."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncIterator

import aiohttp

from app.config import (
    aws_region,
    gpu_idle_timeout_seconds,
    gpu_instance_id,
    gpu_readiness_poll_seconds,
    gpu_startup_timeout_seconds,
    ollama_base_url,
)


logger = logging.getLogger("krama.gpu_instance")


class GpuInstanceController:
    def __init__(self) -> None:
        self._lifecycle_lock = asyncio.Lock()
        self._activity_lock = asyncio.Lock()
        self._active_jobs = 0
        self._last_activity = datetime.now(timezone.utc)

    @property
    def enabled(self) -> bool:
        return bool(gpu_instance_id())

    def _ec2_client(self):
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError("AWS GPU lifecycle requires the boto3 backend dependency.") from exc
        return boto3.client("ec2", region_name=aws_region())

    async def _instance_state(self) -> str:
        instance_id = gpu_instance_id()

        def describe() -> str:
            response = self._ec2_client().describe_instances(InstanceIds=[instance_id])
            reservations = response.get("Reservations") or []
            instances = reservations[0].get("Instances") if reservations else []
            if not instances:
                raise RuntimeError(f"GPU EC2 instance {instance_id} was not found.")
            return str((instances[0].get("State") or {}).get("Name") or "unknown")

        return await asyncio.to_thread(describe)

    async def _start_instance(self) -> None:
        instance_id = gpu_instance_id()

        def start() -> None:
            self._ec2_client().start_instances(InstanceIds=[instance_id])

        await asyncio.to_thread(start)
        logger.info("Start requested for GPU EC2 instance %s", instance_id)

    async def _stop_instance(self) -> None:
        instance_id = gpu_instance_id()

        def stop() -> None:
            self._ec2_client().stop_instances(InstanceIds=[instance_id])

        await asyncio.to_thread(stop)
        logger.info("Stop requested for idle GPU EC2 instance %s", instance_id)

    async def _ollama_ready(self) -> bool:
        timeout = aiohttp.ClientTimeout(total=5)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(f"{ollama_base_url()}/api/tags") as response:
                    return response.status < 500
        except (aiohttp.ClientError, asyncio.TimeoutError, TimeoutError):
            return False

    async def ensure_ready(self) -> None:
        if not self.enabled:
            return

        async with self._lifecycle_lock:
            if await self._ollama_ready():
                return

            deadline = asyncio.get_running_loop().time() + gpu_startup_timeout_seconds()
            state = await self._instance_state()
            if state in {"shutting-down", "terminated"}:
                raise RuntimeError(f"GPU EC2 instance cannot be started because it is {state}.")

            while state == "stopping":
                if asyncio.get_running_loop().time() >= deadline:
                    raise RuntimeError("GPU EC2 instance did not finish stopping before the startup timeout.")
                await asyncio.sleep(gpu_readiness_poll_seconds())
                state = await self._instance_state()

            if state == "stopped":
                await self._start_instance()
            elif state not in {"pending", "running"}:
                raise RuntimeError(f"GPU EC2 instance is in unsupported state: {state}.")

            while asyncio.get_running_loop().time() < deadline:
                state = await self._instance_state()
                if state == "running" and await self._ollama_ready():
                    logger.info("GPU EC2 and Ollama are ready")
                    return
                if state in {"shutting-down", "terminated", "stopped"}:
                    raise RuntimeError(f"GPU EC2 became {state} while waiting for Ollama.")
                await asyncio.sleep(gpu_readiness_poll_seconds())

            raise RuntimeError("GPU EC2 started, but Ollama did not become ready before the startup timeout.")

    @asynccontextmanager
    async def generation_lease(self) -> AsyncIterator[None]:
        async with self._activity_lock:
            self._active_jobs += 1
            self._last_activity = datetime.now(timezone.utc)
        try:
            await self.ensure_ready()
            yield
        finally:
            async with self._activity_lock:
                self._active_jobs = max(0, self._active_jobs - 1)
                self._last_activity = datetime.now(timezone.utc)

    async def monitor_idle_shutdown(self) -> None:
        if not self.enabled:
            logger.info("GPU EC2 lifecycle disabled because GPU_INSTANCE_ID is not configured")
            return

        check_seconds = min(30, max(5, gpu_idle_timeout_seconds() // 4))
        while True:
            await asyncio.sleep(check_seconds)
            async with self._activity_lock:
                active_jobs = self._active_jobs
                idle_seconds = (datetime.now(timezone.utc) - self._last_activity).total_seconds()
            if active_jobs or idle_seconds < gpu_idle_timeout_seconds():
                continue

            async with self._lifecycle_lock:
                async with self._activity_lock:
                    if self._active_jobs:
                        continue
                    idle_seconds = (datetime.now(timezone.utc) - self._last_activity).total_seconds()
                    if idle_seconds < gpu_idle_timeout_seconds():
                        continue
                try:
                    if await self._instance_state() == "running":
                        await self._stop_instance()
                    async with self._activity_lock:
                        self._last_activity = datetime.now(timezone.utc)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("Could not stop the idle GPU EC2 instance")


gpu_instance_controller = GpuInstanceController()


def gpu_generation_lease():
    return gpu_instance_controller.generation_lease()


async def monitor_gpu_idle_shutdown() -> None:
    await gpu_instance_controller.monitor_idle_shutdown()
