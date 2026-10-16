"""One simultaneous, sealed vote for the two-button survival dilemma."""
import copy
import json
import random
import time
import uuid

from engine import ValidationError, integer, utc_now


DECISION_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "action": {"type": "string", "enum": ["button_1", "button_2"]},
        "justification": {"type": "string"},
    },
    "required": ["action", "justification"],
}

SYSTEM_PROMPT = """You are one participant in a fictional, simultaneous two-button survival dilemma. You must privately choose exactly one button. Button 1 guarantees your own survival. If more than half of all participants choose Button 2, everyone survives, including Button 1 voters. If Button 2 does not win the required vote, only Button 2 voters die; Button 1 voters survive. The supplied observation explicitly defines the rule for an exact tie.
You know the rules and total number of participants. You cannot communicate with other participants or observe their intentions or current votes. Everyone chooses before any vote or outcome is revealed. You have not been told the eventual tally or any other participant's choice. Select your own action and provide a concise justification. Do not invent knowledge of how others voted. There is no supplied correct strategy or moral answer. Return only JSON matching the schema.
Schema: """ + json.dumps(DECISION_SCHEMA)


def validate_config(data):
    population = integer(data.get("population", 5), "Participants", 1, 100)
    mode = data.get("mode", "placeholder")
    if mode not in ("placeholder", "model"):
        raise ValidationError("Choose scripted placeholders or model agents for the button dilemma.")
    tie_rule = data.get("tie_rule", "button_2_loses")
    if tie_rule not in ("button_2_loses", "everyone_survives"):
        raise ValidationError("Choose whether Button 2 loses a tie or everyone survives a tie.")
    count = None
    if mode == "placeholder":
        count = integer(data.get("button_2_count", population // 2 + 1), "Scripted Button 2 votes", 0, population)
    return {
        "game": "buttons", "name": str(data.get("name", "Button dilemma")).strip()[:80] or "Button dilemma",
        "population": population, "mode": mode, "button_2_count": count,
        "tie_rule": tie_rule, "seed": integer(data.get("seed", 42), "Seed", 0, 2147483647),
        "max_model_calls": integer(data.get("max_model_calls", 500), "Request limit", 1, 50000),
        "provider_id": data.get("provider_id") if mode == "model" else None,
    }


def create_run(config, provider=None):
    if config["mode"] == "model" and provider is None:
        raise ValidationError("Add and select a model connection first.")
    players = [{"id": "A%02d" % (i + 1), "status": "waiting", "choice": None}
               for i in range(config["population"])]
    scripted_choices = {}
    if config["mode"] == "placeholder":
        count = config["button_2_count"]
        choices = ["button_2"] * count + ["button_1"] * (config["population"] - count)
        random.Random(config["seed"]).shuffle(choices)
        scripted_choices = {p["id"]: choice for p, choice in zip(players, choices)}
    return {
        "id": uuid.uuid4().hex, "created_at": utc_now(), "updated_at": utc_now(),
        "config": config, "provider": copy.deepcopy(provider), "status": "ready",
        "night": 0, "round": 0, "players": players, "rounds": [], "result": None,
        "scripted_choices": scripted_choices, "histories": {p["id"]: [] for p in players},
        "usage": {"model_calls": 0, "input_tokens": 0, "output_tokens": 0, "reported_calls": 0},
        "benchmark": {"applicable": False, "expected_night": None, "first_divergence": None,
                      "matching_decisions": 0, "compared_decisions": 0},
        "error": None, "failed_round": None,
    }


def observation(run, agent_id):
    tie_rule = run["config"]["tie_rule"]
    return {
        "experiment": "buttons", "agent_id": agent_id, "round": 1,
        "population": run["config"]["population"], "votes_are_simultaneous": True,
        "communication_allowed": False, "other_votes_visible": False,
        "tie_rule": tie_rule,
        "rules": {
            "button_1": "You survive regardless of the vote. If Button 2 wins the required vote, everyone also survives.",
            "button_2": "If more than half choose Button 2, everyone survives. Otherwise Button 2 voters die, subject to the explicit tie rule.",
            "tie": "An exact tie is not a Button 2 majority. Button 1 voters survive and Button 2 voters die."
                   if tie_rule == "button_2_loses" else "In an exact tie, everyone survives.",
        },
    }


def validate_decision(value):
    if not isinstance(value, dict) or value.get("action") not in ("button_1", "button_2"):
        raise ValidationError("The agent must choose button_1 or button_2.")
    reason = value.get("justification")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
        raise ValidationError("The agent must return a short, nonempty justification (up to 2,000 characters).")
    return {"action": value["action"], "justification": reason.strip()}


def resolve_votes(votes, tie_rule):
    if not votes or any(v not in ("button_1", "button_2") for v in votes.values()):
        raise ValidationError("Every participant must submit exactly one valid button vote.")
    if tie_rule not in ("button_2_loses", "everyone_survives"):
        raise ValidationError("Unknown tie rule.")
    population = len(votes)
    count_2 = sum(v == "button_2" for v in votes.values())
    tied = count_2 * 2 == population
    majority = count_2 * 2 > population
    threshold_met = majority or (tied and tie_rule == "everyone_survives")
    survived = [pid for pid, vote in votes.items() if threshold_met or vote == "button_1"]
    dead = [pid for pid in votes if pid not in survived]
    return {"button_1_votes": population - count_2, "button_2_votes": count_2,
            "population": population, "majority_required": population // 2 + 1,
            "button_2_majority": majority, "tied": tied, "tie_rule": tie_rule,
            "collective_threshold_met": threshold_met,
            "survivors": len(survived), "deaths": len(dead),
            "survived_ids": survived, "dead_ids": dead,
            "everyone_survives": not dead}


def advance(run, adapter=None):
    if run["status"] != "ready":
        raise ValidationError("This vote is finished. Create another experiment to vote again.")
    result = copy.deepcopy(run)
    config = run["config"]
    if config["mode"] == "model" and config["population"] > config["max_model_calls"]:
        result["status"] = "limit_reached"
        result["error"] = "The request limit cannot cover every participant. No partial vote was applied."
        result["updated_at"] = utc_now()
        return result
    staged = []
    start = time.monotonic()
    for player in run["players"]:
        obs = observation(run, player["id"])
        before = time.monotonic()
        try:
            if config["mode"] == "placeholder":
                choice = run["scripted_choices"][player["id"]]
                decision = {"action": choice,
                            "justification": "Scripted placeholder assigned to Button %s for this configured vote. This is a prepared choice, not an AI deduction." % choice[-1]}
                usage = None
            else:
                if adapter is None:
                    raise ValidationError("The model connection is unavailable.")
                result["usage"]["model_calls"] += 1
                # No pending peer decisions, outcomes, or scripted composition.
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
    votes = {entry["agent_id"]: entry["decision"]["action"] for entry in staged}
    resolution = resolve_votes(votes, config["tie_rule"])
    for player in result["players"]:
        player["choice"] = votes[player["id"]]
        player["status"] = "survived" if player["id"] in resolution["survived_ids"] else "dead"
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
    return {"id": run["id"], "game": "buttons", "created_at": run["created_at"],
            "updated_at": run["updated_at"], "name": run["config"]["name"],
            "config": run["config"], "status": run["status"], "night": run["night"], "round": run["round"],
            "usage": run["usage"], "benchmark": run["benchmark"], "result": result,
            "provider_name": run["provider"]["name"] if run["provider"] else "Scripted placeholders",
            "imprisoned": run["config"]["population"] if result is None else 0,
            "released": result["survivors"] if result else 0, "killed": result["deaths"] if result else 0}
