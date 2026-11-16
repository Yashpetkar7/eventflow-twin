"""Language-model personas of the agents that may call a model (docs/15): intake, the four specialists, explainer,
messenger, ask. Each persona has its own system prompt and a JSON schema restricted to its own slice of the menu;
whatever it returns is validated, simulated and checked by code before anyone sees it.

Without a model (the booth and the public site run offline) every function here returns the agent's code policy:
no extra bundles, template texts.
"""
from __future__ import annotations

import time


def specialist_bundles(ctx, agent: str, buf: list) -> list[dict]:
    """Extra bundles a specialist's model proposes inside its own measures (none without a model)."""
    return []


def explain_options(ctx, buf: list) -> float:
    """The explainer's model rewrites the option texts (numbers checked by the verifier); returns the step's start time."""
    return time.perf_counter()
