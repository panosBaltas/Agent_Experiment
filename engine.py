"""Deterministic island environment. Policies receive only prisoner observations."""
import copy
import random
import time
import uuid
from datetime import datetime, timezone


class ValidationError(ValueError):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def integer(value, name, lower, upper):
    if isinstance(value, bool):
        raise ValidationError("%s must be a whole number." % name)
    try:
        result = int(value)
        if float(value) != result:
            raise ValueError()
    except (TypeError, ValueError, OverflowError):
        raise ValidationError("%s must be a whole number." % name)
    if not lower <= result <= upper:
        raise ValidationError("%s must be between %s and %s." % (name, lower, upper))
    return result


def validate_config(data):
    game = data.get("game", "island")
    if game == "buttons":
        from button_game import validate_config as validate_buttons
        return validate_buttons(data)
    if game != "island":
        raise ValidationError("Choose the green-eyed island or the button dilemma.")
    population = integer(data.get("population", 5), "Population", 1, 100)
    green = integer(data.get("green_count", population), "Green-eyed prisoners", 0, population)
    announcement = data.get("announcement", "public")
    if announcement not in ("public", "none"):
        raise ValidationError("Choose a public announcement or no announcement.")
    minimum = integer(data.get("minimum_green", 1), "Announcement minimum", 1, 100)
    if announcement == "public" and minimum > green:
        raise ValidationError("A truthful announcement cannot exceed the green-eyed population.")
    mode = data.get("mode", "reference")
    if mode not in ("reference", "model"):
        raise ValidationError("Choose reference or model agents.")
    name = str(data.get("name", "Island experiment")).strip()[:80]
    if not name:
        name = "Island experiment"
    return {
        "game": "island", "name": name, "population": population, "green_count": green,
        "announcement": announcement, "minimum_green": minimum,
        "announcement_delay": integer(data.get("announcement_delay", 0), "Announcement delay", 0, 200),
        "max_nights": integer(data.get("max_nights", 20), "Night limit", 1, 500),
        "max_model_calls": integer(data.get("max_model_calls", 500), "Request limit", 1, 50000),
        "seed": integer(data.get("seed", 42), "Seed", 0, 2147483647),
        "mode": mode, "provider_id": data.get("provider_id") if mode == "model" else None,
    }


def create_run(data, provider=None):
    config = validate_config(data)
    if config["game"] == "buttons":
        from button_game import create_run as create_buttons
        return create_buttons(config, provider)
    if config["mode"] == "model" and provider is None:
        raise ValidationError("Add and select a model connection first.")
    colours = ["green"] * config["green_count"] + ["not_green"] * (config["population"] - config["green_count"])
    random.Random(config["seed"]).shuffle(colours)
    prisoners = [{"id": "P%02d" % (i + 1), "colour": colour,
                  "status": "imprisoned", "departed_night": None}
                 for i, colour in enumerate(colours)]
    deadline = None
    if config["announcement"] == "public":
        deadline = config["announcement_delay"] + config["green_count"] - config["minimum_green"] + 1
    return {
        "id": uuid.uuid4().hex, "created_at": utc_now(), "updated_at": utc_now(),
        "config": config, "provider": copy.deepcopy(provider), "status": "ready",
        "night": 0, "prisoners": prisoners, "rounds": [],
        "histories": {p["id"]: [] for p in prisoners},
        "usage": {"model_calls": 0, "input_tokens": 0, "output_tokens": 0, "reported_calls": 0},
        "benchmark": {"expected_night": deadline, "first_divergence": None,
                      "matching_decisions": 0, "compared_decisions": 0},
        "error": None, "failed_round": None,
    }


def observation(run, prisoner_id, night):
    """Never return the subject's eye colour, world counts, or private peer decisions."""
    config = run["config"]
    announcements = []
    if config["announcement"] == "public" and night > config["announcement_delay"]:
        q = config["minimum_green"]
        announcements = [{"night": config["announcement_delay"] + 1,
                          "minimum_green": q,
                          "text": "At least %d %s of the original group %s green eyes." %
                          (q, "member" if q == 1 else "members", "has" if q == 1 else "have"),
                          "publicly_heard_by_everyone": True}]
    return {
        "prisoner_id": prisoner_id, "night": night,
        "original_population": config["population"],
        "visible_prisoners": [{"id": p["id"], "eye_colour": p["colour"]}
                              for p in run["prisoners"]
                              if p["id"] != prisoner_id and p["status"] == "imprisoned"],
        "present_ids": [p["id"] for p in run["prisoners"] if p["status"] == "imprisoned"],
        "announcements": announcements,
        "public_history": [{"night": r["night"], "missing_next_morning": r["departed_ids"]}
                           for r in run["rounds"]],
    }


def reference_decision(obs, history=None):
    """Compact policy valid for the complete-visibility, ideal-logician benchmark."""
    if not obs["announcements"]:
        return {"action": "wait", "possible_own_colours": ["green", "not_green"],
                "justification": "I can see other prisoners, but no public eye-colour announcement has established the shared premise. Both colours remain possible."}
    announcement = obs["announcements"][0]
    elapsed = obs["night"] - announcement["night"]
    departures = [h for h in obs["public_history"]
                  if h["night"] >= announcement["night"] and h["missing_next_morning"]]
    if departures:
        return {"action": "wait", "possible_own_colours": ["not_green"],
                "justification": "The green-eyed group departed at its first justified opportunity. Under the shared perfect-reasoning rules, my continued presence places me outside that group."}
    seen = sum(p["eye_colour"] == "green" for p in obs["visible_prisoners"])
    lower_bound = announcement["minimum_green"] + elapsed
    if seen < lower_bound:
        return {"action": "leave", "possible_own_colours": ["green"],
                "justification": "The public announcement and %d completed night%s without departures require at least %d green-eyed prisoners. I see %d, so I must be the additional green-eyed prisoner." %
                (elapsed, "" if elapsed == 1 else "s", lower_bound, seen)}
    return {"action": "wait", "possible_own_colours": ["green", "not_green"],
            "justification": "I see %d green-eyed prisoner%s. The announcement and completed head counts establish a lower bound of %d. This still permits either colour for my own eyes." %
            (seen, "" if seen == 1 else "s", lower_bound)}


def validate_decision(value):
    if not isinstance(value, dict) or value.get("action") not in ("wait", "leave"):
        raise ValidationError("The model must return an action of wait or leave.")
    possibilities = value.get("possible_own_colours")
    if not isinstance(possibilities, list) or not 1 <= len(possibilities) <= 2:
        raise ValidationError("The model must return one or two possible eye colours.")
    if any(p not in ("green", "not_green") for p in possibilities) or len(set(possibilities)) != len(possibilities):
        raise ValidationError("Possible eye colours must be green and/or not_green, without duplicates.")
    reason = value.get("justification")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
        raise ValidationError("The model must return a short, nonempty justification (up to 2,000 characters).")
    return {"action": value["action"], "possible_own_colours": possibilities, "justification": reason.strip()}


def advance(run, adapter=None):
    """Stage private decisions, then publish one atomic night. Failure is never a wait."""
    if run["config"].get("game", "island") == "buttons":
        from button_game import advance as advance_buttons
        return advance_buttons(run, adapter)
    # Completed records are immutable. Copy the mutable containers, not every
    # historical observation on each night (important for 100-prisoner runs).
    next_run = {**run, "prisoners": [dict(p) for p in run["prisoners"]],
                "rounds": list(run["rounds"]),
                "histories": {pid: list(records) for pid, records in run["histories"].items()},
                "usage": dict(run["usage"]), "benchmark": copy.deepcopy(run["benchmark"])}
    if run["status"] not in ("ready", "paused"):
        raise ValidationError("This experiment is finished. Create a new run to continue testing.")
    active = [p for p in run["prisoners"] if p["status"] == "imprisoned"]
    config = run["config"]
    if config["mode"] == "model" and next_run["usage"]["model_calls"] + len(active) > config["max_model_calls"]:
        next_run["status"] = "limit_reached"
        next_run["error"] = "Request limit reached before starting another complete night. No partial decisions were applied."
        return next_run
    night = run["night"] + 1
    staged = []
    comparable = run["benchmark"]["first_divergence"] is None
    started = time.monotonic()
    for prisoner in active:
        obs = observation(run, prisoner["id"], night)
        before = time.monotonic()
        try:
            if config["mode"] == "reference":
                decision = reference_decision(obs)
                usage = None
            else:
                if adapter is None:
                    raise ValidationError("The model connection is unavailable.")
                next_run["usage"]["model_calls"] += 1
                # The inspector's records also contain evaluator annotations.
                # Strip them at the adapter boundary, even for custom policies.
                private_history = [{"prisoner_id": record["prisoner_id"],
                                    "observation": copy.deepcopy(record["observation"]),
                                    "decision": copy.deepcopy(record["decision"])}
                                   for record in run["histories"][prisoner["id"]]]
                decision, usage = adapter.decide(copy.deepcopy(obs), private_history)
                if usage:
                    next_run["usage"]["input_tokens"] += usage.get("input_tokens", 0)
                    next_run["usage"]["output_tokens"] += usage.get("output_tokens", 0)
                    next_run["usage"]["reported_calls"] += 1
            decision = validate_decision(decision)
            expected = None
            if comparable:
                deadline = run["benchmark"]["expected_night"]
                expected = "leave" if prisoner["colour"] == "green" and deadline == night else "wait"
            staged.append({"prisoner_id": prisoner["id"], "observation": obs,
                           "decision": decision, "reference_action": expected,
                           "duration_ms": round((time.monotonic() - before) * 1000), "usage": usage})
        except Exception as exc:
            next_run["status"] = "failed"
            next_run["error"] = str(exc)[:2000]
            next_run["failed_round"] = {"night": night, "prisoner_id": prisoner["id"],
                                        "staged_decisions": staged, "message": str(exc)[:2000]}
            next_run["updated_at"] = utc_now()
            return next_run
    departed = []
    for entry in staged:
        prisoner = next(p for p in next_run["prisoners"] if p["id"] == entry["prisoner_id"])
        decision = entry["decision"]
        next_run["histories"][prisoner["id"]].append(entry)
        if entry["reference_action"] is not None:
            benchmark = next_run["benchmark"]
            benchmark["compared_decisions"] += 1
            if decision["action"] == entry["reference_action"]:
                benchmark["matching_decisions"] += 1
            elif benchmark["first_divergence"] is None:
                category = "unsafe_departure" if prisoner["colour"] != "green" and decision["action"] == "leave" else ("premature_departure" if decision["action"] == "leave" else "missed_departure")
                benchmark["first_divergence"] = {"night": night, "prisoner_id": prisoner["id"],
                                                  "expected_action": entry["reference_action"],
                                                  "actual_action": decision["action"], "category": category}
        if decision["action"] == "leave":
            prisoner["status"] = "released" if prisoner["colour"] == "green" else "killed"
            prisoner["departed_night"] = night
            departed.append(prisoner["id"])
    next_run["rounds"].append({"night": night, "decisions": staged, "departed_ids": departed,
                               "reference_applicable": comparable,
                               "duration_ms": round((time.monotonic() - started) * 1000)})
    next_run["night"] = night
    next_run["status"] = "paused"
    remaining = [p for p in next_run["prisoners"] if p["status"] == "imprisoned"]
    if not remaining:
        next_run["status"] = "completed"
    elif config["mode"] == "reference" and departed:
        next_run["status"] = "completed"
    elif night >= config["max_nights"]:
        next_run["status"] = "limit_reached"
    next_run["updated_at"] = utc_now()
    return next_run


def summary(run):
    if run["config"].get("game", "island") == "buttons":
        from button_game import summary as summarize_buttons
        return summarize_buttons(run)
    statuses = {s: sum(p["status"] == s for p in run["prisoners"])
                for s in ("imprisoned", "released", "killed")}
    return {"id": run["id"], "game": "island", "created_at": run["created_at"], "updated_at": run["updated_at"],
            "name": run["config"]["name"], "config": run["config"], "status": run["status"],
            "night": run["night"], "usage": run["usage"], "benchmark": run["benchmark"],
            "provider_name": run["provider"]["name"] if run["provider"] else "Logical reference",
            **statuses}
