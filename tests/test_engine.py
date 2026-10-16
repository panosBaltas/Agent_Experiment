import copy
import unittest

from engine import ValidationError, advance, create_run, observation, reference_decision, validate_config


class FakeAdapter:
    def __init__(self, action="wait", fail_at=None):
        self.calls = []
        self.action = action
        self.fail_at = fail_at

    def decide(self, obs, history):
        self.calls.append((copy.deepcopy(obs), copy.deepcopy(history)))
        if len(self.calls) == self.fail_at:
            raise ValidationError("Deliberate transport failure")
        return {"action": self.action, "possible_own_colours": ["green", "not_green"],
                "justification": "Mock decision"}, {"input_tokens": 10, "output_tokens": 5}


class EngineTests(unittest.TestCase):
    def completed(self, **config):
        run = create_run(config)
        while run["status"] in ("ready", "paused"):
            run = advance(run)
        return run

    def test_canonical_one_through_hundred(self):
        for n in [1, 2, 3, 5, 8, 10, 20, 100]:
            with self.subTest(population=n):
                run = self.completed(population=n, green_count=n, max_nights=n+1)
                self.assertEqual(run["night"], n)
                self.assertEqual(run["status"], "completed")
                self.assertTrue(all(p["departed_night"] == n and p["status"] == "released" for p in run["prisoners"]))
                self.assertIsNone(run["benchmark"]["first_divergence"])

    def test_mixed_stronger_and_delayed_announcements(self):
        for n in range(1, 7):
            for green in range(1, n+1):
                for q in range(1, green+1):
                    with self.subTest(n=n, green=green, q=q):
                        run = self.completed(population=n, green_count=green, minimum_green=q, announcement_delay=2, max_nights=15)
                        deadline = 2 + green-q+1
                        for prisoner in run["prisoners"]:
                            if prisoner["colour"] == "green":
                                self.assertEqual(prisoner["departed_night"], deadline)
                            else:
                                self.assertEqual(prisoner["status"], "imprisoned")
                        self.assertIsNone(run["benchmark"]["first_divergence"])

    def test_no_announcement_and_zero_green_control(self):
        for green in range(6):
            run = self.completed(population=5, green_count=green, announcement="none", max_nights=8)
            self.assertEqual(run["status"], "limit_reached")
            self.assertTrue(all(p["status"] == "imprisoned" for p in run["prisoners"]))
            self.assertIsNone(run["benchmark"]["expected_night"])

    def test_agent_payload_omits_own_colour_and_hidden_counts(self):
        run = create_run({"population": 5, "green_count": 3})
        for p in run["prisoners"]:
            obs = observation(run, p["id"], 1)
            self.assertNotIn("green_count", obs)
            self.assertNotIn("colour", obs)
            self.assertNotIn("eye_colour", obs)
            self.assertEqual(len(obs["visible_prisoners"]), 4)
            self.assertNotIn(p["id"], [v["id"] for v in obs["visible_prisoners"]])

    def test_all_actions_resolve_after_all_decisions(self):
        run = create_run({"mode": "model", "population": 3, "green_count": 3}, {"id":"fake","name":"Fake"})
        adapter = FakeAdapter("leave")
        result = advance(run, adapter)
        self.assertEqual(run["night"], 0)
        self.assertTrue(all(not obs["public_history"] and len(obs["visible_prisoners"]) == 2 and not history
                            for obs, history in adapter.calls))
        self.assertEqual(result["benchmark"]["first_divergence"]["category"], "premature_departure")
        self.assertTrue(all(p["status"] == "released" for p in result["prisoners"]))

    def test_failure_rolls_back_entire_night_and_preserves_attempts(self):
        run = create_run({"mode": "model", "population": 3}, {"id":"fake","name":"Fake"})
        result = advance(run, FakeAdapter("leave", fail_at=2))
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["night"], 0)
        self.assertEqual(result["rounds"], [])
        self.assertTrue(all(not history for history in result["histories"].values()))
        self.assertTrue(all(p["status"] == "imprisoned" for p in result["prisoners"]))
        self.assertEqual(result["usage"]["model_calls"], 2)
        self.assertEqual(len(result["failed_round"]["staged_decisions"]), 1)

    def test_model_request_limit_is_checked_before_round(self):
        run = create_run({"mode":"model", "population":5, "max_model_calls":4}, {"id":"fake","name":"Fake"})
        adapter = FakeAdapter()
        result = advance(run, adapter)
        self.assertEqual(result["status"], "limit_reached")
        self.assertEqual(len(adapter.calls), 0)
        self.assertEqual(result["night"], 0)

    def test_histories_remain_private_across_rounds(self):
        run = create_run({"mode":"model", "population":3, "max_nights":3}, {"id":"fake","name":"Fake"})
        adapter = FakeAdapter()
        run = advance(run, adapter)
        run = advance(run, adapter)
        for obs, history in adapter.calls[3:]:
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]["prisoner_id"], obs["prisoner_id"])
            self.assertNotIn("reference_action", history[0])
            self.assertNotIn("benchmark", history[0])
            self.assertNotIn("usage", history[0])
            self.assertEqual(len(obs["public_history"]), 1)
            self.assertNotIn("decisions", obs["public_history"][0])

    def test_ineligible_departures_are_recorded_and_later_scoring_stops(self):
        run = create_run({"mode":"model", "population":3, "green_count":1}, {"id":"fake","name":"Fake"})
        result = advance(run, FakeAdapter("leave"))
        self.assertEqual(sum(p["status"] == "killed" for p in result["prisoners"]), 2)
        self.assertIsNotNone(result["benchmark"]["first_divergence"])
        waiting = create_run({"mode":"model", "population":1}, {"id":"fake","name":"Fake"})
        waiting = advance(waiting, FakeAdapter())
        waiting = advance(waiting, FakeAdapter())
        self.assertFalse(waiting["rounds"][1]["reference_applicable"])
        self.assertIsNone(waiting["rounds"][1]["decisions"][0]["reference_action"])

    def test_reference_uses_only_permitted_information(self):
        run = create_run({"population":2})
        obs = observation(run, "P01", 1)
        self.assertEqual(reference_decision(obs)["action"], "wait")
        run = advance(run)
        self.assertEqual(reference_decision(observation(run, "P01", 2))["action"], "leave")

    def test_invalid_config_is_rejected(self):
        for data in [{"population":0},{"population":2.5},{"population":True},
                     {"population":3,"green_count":4},{"green_count":0},
                     {"minimum_green":6},{"max_nights":0},{"announcement":"private"}]:
            with self.subTest(data=data), self.assertRaises(ValidationError):
                validate_config(data)


if __name__ == "__main__":
    unittest.main()
