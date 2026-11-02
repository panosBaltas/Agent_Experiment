import unittest

import engine
import guessing_game


class GuessingTests(unittest.TestCase):
    def test_target_winner_and_exact_tie(self):
        result = guessing_game.resolve_guesses({"A01": 20, "A02": 40, "A03": 60})
        self.assertEqual(result["average"], 40)
        self.assertAlmostEqual(result["target"], 26.6666666667)
        self.assertEqual(result["winner_ids"], ["A01"])
        tied = guessing_game.resolve_guesses({"A01": 0, "A02": 1, "A03": 1, "A04": 1})
        self.assertEqual(tied["target"], 0.5)
        self.assertEqual(tied["winner_ids"], ["A01", "A02", "A03", "A04"])

    def test_scripted_seed_and_private_observations(self):
        config = {"game": "guessing", "population": 5, "seed": 123}
        first = engine.create_run(config)
        second = engine.create_run(config)
        self.assertEqual(first["scripted_guesses"], second["scripted_guesses"])
        obs = guessing_game.observation(first, "A01")
        self.assertNotIn("scripted_guesses", obs)
        self.assertNotIn("guess", obs)
        result = engine.advance(first)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["round"], 1)
        self.assertEqual(result["usage"]["model_calls"], 0)
        self.assertEqual(len(result["result"]["winner_ids"]), len([p for p in result["players"] if p["status"] == "winner"]))
        self.assertTrue(all(len(history) == 1 for history in result["histories"].values()))
        self.assertEqual(engine.summary(result)["game"], "guessing")
        with self.assertRaises(engine.ValidationError):
            engine.advance(result)

    def test_model_agents_receive_isolated_requests(self):
        seen = []

        class Adapter:
            def decide(self, obs, history):
                seen.append((obs, history))
                return {"guess": 10 * len(seen), "justification": "Mock independent choice"}, {"input_tokens": 10, "output_tokens": 5}

        run = engine.create_run({"game": "guessing", "population": 3, "mode": "model"}, {"name": "Mock"})
        self.assertEqual(run["scripted_guesses"], {})
        result = engine.advance(run, Adapter())
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result"]["winner_ids"], ["A01"])
        self.assertEqual(result["usage"]["model_calls"], 3)
        self.assertEqual(result["usage"]["input_tokens"], 30)
        self.assertTrue(all(not history for _, history in seen))
        self.assertEqual([obs["agent_id"] for obs, _ in seen], ["A01", "A02", "A03"])
        self.assertTrue(all("other_guesses_visible" in obs and not obs["other_guesses_visible"] for obs, _ in seen))

    def test_failed_or_over_budget_round_does_not_reveal_partial_guesses(self):
        calls = []

        class Adapter:
            def decide(self, obs, history):
                calls.append(obs)
                return ({"guess": 12, "justification": "Mock"} if len(calls) == 1 else
                        {"guess": 101, "justification": "Invalid"}), None

        run = engine.create_run({"game": "guessing", "population": 3, "mode": "model"}, {"name": "Mock"})
        failed = engine.advance(run, Adapter())
        self.assertEqual(failed["status"], "failed")
        self.assertIsNone(failed["result"])
        self.assertEqual(failed["round"], 0)
        self.assertTrue(all(p["guess"] is None for p in failed["players"]))
        self.assertTrue(all(not history for history in failed["histories"].values()))
        self.assertEqual(len(failed["failed_round"]["staged_decisions"]), 1)

        limited = engine.create_run({"game": "guessing", "population": 3, "mode": "model", "max_model_calls": 2}, {"name": "Mock"})
        result = engine.advance(limited, Adapter())
        self.assertEqual(result["status"], "limit_reached")
        self.assertEqual(result["usage"]["model_calls"], 0)
        self.assertEqual(len(calls), 2)

    def test_rejects_invalid_config_and_guesses(self):
        for settings in ({"population": 0}, {"population": 101}, {"mode": "reference"}, {"seed": -1}, {"game": "missing"}):
            with self.subTest(settings=settings), self.assertRaises(engine.ValidationError):
                engine.create_run({"game": "guessing", **settings})
        for guess in (-1, 101, 2.5, "5", True, None):
            with self.subTest(guess=guess), self.assertRaises(engine.ValidationError):
                guessing_game.validate_decision({"guess": guess, "justification": "Test"})
        with self.assertRaises(engine.ValidationError):
            guessing_game.validate_decision({"guess": 5, "justification": " "})


if __name__ == "__main__":
    unittest.main()
