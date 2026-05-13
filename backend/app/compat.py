import inspect
import logging


logger = logging.getLogger(__name__)


def install_starlette_router_compat() -> None:
    """
    Keep FastAPI importable when the local Python environment has a Starlette
    Router whose constructor is older/newer than the FastAPI version expects.
    """
    try:
        from starlette.routing import Router
    except Exception:
        return

    if getattr(Router, "_krama_compat_installed", False):
        return

    original_init = Router.__init__
    supported_kwargs = set(inspect.signature(original_init).parameters)
    supported_kwargs.discard("self")

    def compatible_init(self, *args, **kwargs):
        on_startup = kwargs.get("on_startup")
        on_shutdown = kwargs.get("on_shutdown")
        unsupported_kwargs = sorted(set(kwargs) - supported_kwargs)
        for key in unsupported_kwargs:
            kwargs.pop(key, None)

        if unsupported_kwargs:
            logger.debug(
                "Dropped unsupported Starlette Router kwargs for this environment: %s",
                ", ".join(unsupported_kwargs),
            )

        original_init(self, *args, **kwargs)

        if not hasattr(self, "on_startup"):
            self.on_startup = list(on_startup or [])
        if not hasattr(self, "on_shutdown"):
            self.on_shutdown = list(on_shutdown or [])

    Router.__init__ = compatible_init
    Router._krama_compat_installed = True
