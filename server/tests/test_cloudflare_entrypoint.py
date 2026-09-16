import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class CloudflareEntrypointTests(unittest.TestCase):
    def test_uses_workers_asgi_adapter(self) -> None:
        application = object()
        worker_entrypoint = object()
        asgi = types.SimpleNamespace(entrypoint=lambda app: worker_entrypoint if app is application else None)

        workers = types.ModuleType("workers")
        workers.asgi = asgi
        cloudflare_http = types.ModuleType("cloudflare_http")
        cloudflare_http.app = application

        source = Path(__file__).parents[1] / "cloudflare_app.py"
        spec = importlib.util.spec_from_file_location("cloudflare_app_test", source)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)

        with patch.dict(sys.modules, {"workers": workers, "cloudflare_http": cloudflare_http}):
            spec.loader.exec_module(module)

        self.assertIs(module.Default, worker_entrypoint)


if __name__ == "__main__":
    unittest.main()
