from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import web

from app.services.gpu_instance import GpuInstanceController


class GpuInstanceControllerTests(unittest.IsolatedAsyncioTestCase):
    async def test_stopped_instance_is_started_and_waited_until_ollama_is_ready(self):
        controller = GpuInstanceController()
        controller._instance_state = AsyncMock(side_effect=["stopped", "pending", "running"])
        controller._start_instance = AsyncMock()
        controller._ollama_ready = AsyncMock(side_effect=[False, True])

        with (
            patch("app.services.gpu_instance.gpu_instance_id", return_value="i-gpu"),
            patch("app.services.gpu_instance.gpu_startup_timeout_seconds", return_value=60),
            patch("app.services.gpu_instance.gpu_readiness_poll_seconds", return_value=1),
            patch("app.services.gpu_instance.asyncio.sleep", new=AsyncMock()),
        ):
            await controller.ensure_ready()

        controller._start_instance.assert_awaited_once()
        self.assertEqual(controller._instance_state.await_count, 3)

    async def test_ollama_readiness_uses_the_configured_private_http_endpoint(self):
        requests = []

        async def tags(request):
            requests.append(request.path)
            return web.json_response({"models": [{"name": "gpt-oss:20b"}]})

        app = web.Application()
        app.router.add_get("/api/tags", tags)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]

        try:
            controller = GpuInstanceController()
            with patch("app.services.gpu_instance.ollama_base_url", return_value=f"http://127.0.0.1:{port}"):
                self.assertTrue(await controller._ollama_ready())
        finally:
            await runner.cleanup()

        self.assertEqual(requests, ["/api/tags"])

    async def test_two_generation_leases_are_tracked_until_both_finish(self):
        controller = GpuInstanceController()
        controller.ensure_ready = AsyncMock()

        first = controller.generation_lease()
        second = controller.generation_lease()
        await first.__aenter__()
        await second.__aenter__()
        self.assertEqual(controller._active_jobs, 2)

        await first.__aexit__(None, None, None)
        self.assertEqual(controller._active_jobs, 1)
        await second.__aexit__(None, None, None)
        self.assertEqual(controller._active_jobs, 0)


if __name__ == "__main__":
    unittest.main()
