import copy
import unittest

import button_game
import engine


class ButtonTests(unittest.TestCase):
    def run_vote(self, population, count, **settings):
        return engine.advance(engine.create_run({
            "game": "buttons", "population": population,
            "button_2_count": count, **settings,
        }))

    def test_majority_minority_unanimous_and_tie_outcomes(self):
        for population, count, survivors, deaths in (
            (5, 3, 5, 0), (5, 2, 3, 2), (5, 0, 5, 0),
            (5, 5, 5, 0), (6, 3, 3, 3), (1, 0, 1, 0), (1, 1, 1, 0),
        ):
            with self.subTest(population=population, count=count):
                run = self.run_vote(population, count)
                self.assertEqual(run["status"], "completed")
                self.assertEqual(run["result"]["survivors"], survivors)
                self.assertEqual(run["result"]["deaths"], deaths)
                self.assertEqual(run["result"]["button_2_votes"], count)
                self.assertEqual(run["round"], 1)
                self.assertFalse(run["benchmark"]["applicable"])

    def test_every_split_preserves_button_one_and_requires_strict_majority(self):
        for population in range(1, 13):
            for count in range(population + 1):
                votes = {"A%d" % i: "button_2" if i < count else "button_1"
                         for i in range(population)}
                result = button_game.resolve_votes(votes, "button_2_loses")
                majority = count * 2 > population
                self.assertEqual(result["button_2_majority"], majority)
                self.assertEqual(result["deaths"], 0 if majority else count)
                self.assertEqual(result["survivors"] + result["deaths"], population)
                self.assertTrue(all(votes[p] == "button_2" for p in result["dead_ids"]))
                self.assertEqual(result["everyone_survives"], majority or count == 0)

    def test_explicit_tie_exception_changes_only_ties(self):
        tied = self.run_vote(6, 3, tie_rule="everyone_survives")["result"]
        self.assertTrue(tied["tied"])
        self.assertFalse(tied["button_2_majority"])
        self.assertTrue(tied["everyone_survives"])
        self.assertEqual(self.run_vote(5, 2, tie_rule="everyone_survives")["result"]["deaths"], 2)

    def test_placeholder_seed_and_no_model_calls(self):
        data = {"game": "buttons", "population": 10, "button_2_count": 4, "seed": 7}
        original = engine.create_run(data)
        self.assertEqual(original["scripted_choices"], engine.create_run(data)["scripted_choices"])

        class ForbiddenAdapter:
            def decide(self, *args):
                raise AssertionError("Placeholders must not call a model")

        result = engine.advance(original, ForbiddenAdapter())
        self.assertEqual(result["usage"]["model_calls"], 0)
        self.assertEqual(original["status"], "ready")
        self.assertTrue(all(p["choice"] is None for p in original["players"]))
        self.assertIn("not an AI deduction", result["histories"]["A01"][0]["decision"]["justification"])

    def test_model_observations_are_isolated_until_all_votes_are_resolved(self):
        original = engine.create_run({"game": "buttons", "mode": "model", "population": 5,
                                      "button_2_count": 5}, {"name": "Mock"})
        snapshot = copy.deepcopy(original)
        seen = []

        class Adapter:
            def decide(self, obs, history):
                seen.append(copy.deepcopy(obs))
                self_test.assertEqual(history, [])
                self_test.assertEqual(original, snapshot)
                self_test.assertEqual(set(obs), {"experiment", "agent_id", "round", "population",
                                                "votes_are_simultaneous", "communication_allowed",
                                                "other_votes_visible", "tie_rule", "rules"})
                self_test.assertFalse(obs["other_votes_visible"])
                action = "button_2" if len(seen) <= 2 else "button_1"
                obs["rules"]["button_1"] = "Adapter mutation must not change the recorded observation"
                return {"action": action, "justification": "Mock independent choice"}, {"input_tokens": 10, "output_tokens": 5}

        self_test = self
        result = engine.advance(original, Adapter())
        self.assertEqual(result["result"]["deaths"], 2)
        self.assertEqual(result["usage"]["model_calls"], 5)
        self.assertEqual(result["usage"]["input_tokens"], 50)
        self.assertTrue(all(len(h) == 1 for h in result["histories"].values()))
        self.assertIn("regardless", result["histories"]["A01"][0]["observation"]["rules"]["button_1"])
        self.assertIsNone(result["config"]["button_2_count"])

    def test_failed_vote_does_not_apply_partial_choices(self):
        calls = []

        class Adapter:
            def decide(self, obs, history):
                calls.append(obs)
                return {"action": "button_1" if len(calls) == 1 else "wait",
                        "justification": "Mock choice"}, None

        run = engine.advance(engine.create_run({"game": "buttons", "mode": "model", "population": 3},
                                              {"name": "Mock"}), Adapter())
        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["round"], 0)
        self.assertIsNone(run["result"])
        self.assertEqual(run["usage"]["model_calls"], 2)
        self.assertTrue(all(p["status"] == "waiting" and p["choice"] is None for p in run["players"]))
        self.assertTrue(all(not h for h in run["histories"].values()))
        self.assertEqual(len(run["failed_round"]["staged_decisions"]), 1)

    def test_request_limit_prevents_any_partial_vote(self):
        class Adapter:
            def decide(self, *args):
                raise AssertionError("Insufficient budget must be detected before inference")

        run = engine.advance(engine.create_run({"game": "buttons", "mode": "model",
                                              "population": 5, "max_model_calls": 4}, {"name": "Mock"}), Adapter())
        self.assertEqual(run["status"], "limit_reached")
        self.assertEqual(run["usage"]["model_calls"], 0)
        self.assertIsNone(run["result"])

    def test_invalid_configuration_and_decisions_are_rejected(self):
        for settings in ({"population": 0}, {"population": True}, {"population": 2.5},
                         {"button_2_count": -1}, {"button_2_count": 6}, {"button_2_count": False},
                         {"mode": "reference"}, {"tie_rule": "unknown"}, {"game": "unknown"}):
            with self.subTest(settings=settings), self.assertRaises(engine.ValidationError):
                engine.create_run({"game": "buttons", **settings})
        for decision in (None, {"action": "wait", "justification": "x"},
                         {"action": "button_1", "justification": " "},
                         {"action": "button_2", "justification": "x" * 2001}):
            with self.assertRaises(engine.ValidationError):
                button_game.validate_decision(decision)
        run = self.run_vote(5, 3)
        with self.assertRaises(engine.ValidationError):
            engine.advance(run)

    def test_legacy_island_runs_still_advance_and_summarize(self):
        run = engine.create_run({"population": 1})
        del run["config"]["game"]
        result = engine.advance(run)
        self.assertEqual(engine.summary(result)["game"], "island")
        self.assertEqual(result["prisoners"][0]["status"], "released")


if __name__ == "__main__":
    unittest.main()
