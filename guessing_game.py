"""One simultaneous round of the two-thirds-of-the-average guessing game."""
import copy
import json
import random
import time
import uuid

from engine import ValidationError, integer, utc_now


DECISION_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "guess": {"type": "integer", "minimum": 0, "maximum": 100},
        "justification": {"type": "string"},
    },
    "required": ["guess", "justification"],
}

SYSTEM_PROMPT = """You are one participant in a one-round, simultaneous guessing game. Privately choose one whole number from 0 to 100 inclusive. After everyone has chosen, the organizer calculates the arithmetic average of all submitted guesses and multiplies it by 2/3. The participant or participants whose guesses are closest to that target win; exact ties share the win. Your own guess is included in the average.
You know the rules and number of participants. You cannot communicate or see other participants' guesses before choosing. No previous rounds or peer strategies are supplied. Select your own guess and give a concise justification. Do not claim knowledge of the eventual average or other guesses. Return only JSON matching the schema.
Schema: """ + json.dumps(DECISION_SCHEMA)


def validate_config(data):
    population = integer(data.get("population", 5), "Participants", 1, 100)
    mode = data.get("mode", "placeholder")
    if mode not in ("placeholder", "model"):
        raise ValidationError("Choose scripted guesses or model agents for the two-thirds game.")
    return {
        "game": "guessing", "name": str(data.get("name", "Two-thirds game")).strip()[:80] or "Two-thirds game",
        "population": population, "mode": mode,
        "seed": integer(data.get("seed", 42), "Seed", 0, 2147483647),
        "max_model_calls": integer(data.get("max_model_calls", 500), "Request limit", 1, 50000),
        "provider_id": data.get("provider_id") if mode == "model" else None,
    }


def create_run(config, provider=None):
    if config["mode"] == "model" and provider is None:
        raise ValidationError("Add and select a model connection first.")
    players = [{"id": "A%02d" % (i + 1), "status": "waiting", "guess": None}
               for i in range(config["population"])]
    scripted_guesses = {}
    if config["mode"] == "placeholder":
        rng = random.Random(config["seed"])
        scripted_guesses = {p["id"]: rng.randint(0, 100) for p in players}
    return {
        "id": uuid.uuid4().hex, "created_at": utc_now(), "updated_at": utc_now(),
        "config": config, "provider": copy.deepcopy(provider), "status": "ready",
        "night": 0, "round": 0, "players": players, "rounds": [], "result": None,
        "scripted_guesses": scripted_guesses, "histories": {p["id"]: [] for p in players},
        "usage": {"model_calls": 0, "input_tokens": 0, "output_tokens": 0, "reported_calls": 0},
        "benchmark": {"applicable": False, "expected_night": None, "first_divergence": None,
                      "matching_decisions": 0, "compared_decisions": 0},
        "error": None, "failed_round": None,
    }


def observation(run, agent_id):
    return {
        "experiment": "guessing", "agent_id": agent_id, "round": 1,
        "population": run["config"]["population"], "choices_are_simultaneous": True,
        "communication_allowed": False, "other_guesses_visible": False,
        "minimum_guess": 0, "maximum_guess": 100, "whole_numbers_only": True,
        "target_fraction": {"numerator": 2, "denominator": 3},
        "own_guess_counts_in_average": True, "exact_ties_share_win": True,
    }


def validate_decision(value):
    if not isinstance(value, dict):
        raise ValidationError("The agent must return a guess and justification.")
    guess = value.get("guess")
    if isinstance(guess, bool) or not isinstance(guess, int) or not 0 <= guess <= 100:
        raise ValidationError("Guess must be a whole number from 0 to 100.")
    reason = value.get("justification")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
        raise ValidationError("The agent must return a short, nonempty justification (up to 2,000 characters).")
    return {"guess": guess, "justification": reason.strip()}


def resolve_guesses(guesses):
    if not guesses or any(isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 100
                          for v in guesses.values()):
        raise ValidationError("Every participant must submit one whole-number guess from 0 to 100.")
    population = len(guesses)
    total = sum(guesses.values())
    # Compare exact integer distances to avoid floating-point tie errors.
    distances = {pid: abs(3 * population * guess - 2 * total) for pid, guess in guesses.items()}
    best = min(distances.values())
    winners = [pid for pid, distance in distances.items() if distance == best]
    return {
        "population": population, "average": total / population,
        "target": 2 * total / (3 * population), "winner_ids": winners,
        "winning_guesses": {pid: guesses[pid] for pid in winners},
        "winning_distance": best / (3 * population),
    }


def advance(run, adapter=None):
    if run["status"] != "ready":
        raise ValidationError("This round is finished. Create another experiment to play again.")
    result = copy.deepcopy(run)
    config = run["config"]
    if config["mode"] == "model" and config["population"] > config["max_model_calls"]:
        result["status"] = "limit_reached"
        result["error"] = "The request limit cannot cover every participant. No partial guesses were applied."
        result["updated_at"] = utc_now()
        return result
    staged = []
    start = time.monotonic()
    for player in run["players"]:
        obs = observation(run, player["id"])
        before = time.monotonic()
        try:
            if config["mode"] == "placeholder":
                decision = {"guess": run["scripted_guesses"][player["id"]],
                            "justification": "Seeded uniform random placeholder from 0 to 100. This is a prepared guess, not an AI decision."}
                usage = None
            else:
                if adapter is None:
                    raise ValidationError("The model connection is unavailable.")
                result["usage"]["model_calls"] += 1
                decision, usage = adapter.decide(copy.deepcopy(obs), [])
                if usage:
                    result["usage"]["input_tokens"] += usage.get("input_tokens", 0)
                    result["usage"]["output_tokens"] += usage.get("output_tokens", 0)
                    result["usage"]["reported_calls"] += 1
            decision = validate_decision(decision)
            staged.append({"agent_id": player["id"], "observation": obs, "decision": decision,
                           "duration_ms": round((time.monotonic() - before) * 1000), "usage": usage})
        except Exception as exc:
            result["status"] = "failed"
            result["error"] = str(exc)[:2000]
            result["failed_round"] = {"round": 1, "agent_id": player["id"],
                                      "staged_decisions": staged, "message": str(exc)[:2000]}
            result["updated_at"] = utc_now()
            return result
    guesses = {entry["agent_id"]: entry["decision"]["guess"] for entry in staged}
    resolution = resolve_guesses(guesses)
    for player in result["players"]:
        player["guess"] = guesses[player["id"]]
        player["status"] = "winner" if player["id"] in resolution["winner_ids"] else "finished"
    for entry in staged:
        result["histories"][entry["agent_id"]].append(entry)
    result["rounds"] = [{"round": 1, "decisions": staged, "result": resolution,
                         "duration_ms": round((time.monotonic() - start) * 1000)}]
    result["result"] = resolution
    result["night"] = result["round"] = 1
    result["status"] = "completed"
    result["updated_at"] = utc_now()
    return result


def summary(run):
    result = run["result"]
    return {"id": run["id"], "game": "guessing", "created_at": run["created_at"],
            "updated_at": run["updated_at"], "name": run["config"]["name"],
            "config": run["config"], "status": run["status"], "night": run["night"], "round": run["round"],
            "usage": run["usage"], "benchmark": run["benchmark"], "result": result,
            "provider_name": run["provider"]["name"] if run["provider"] else "Seeded random guesses"}
