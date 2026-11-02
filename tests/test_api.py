import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from engine import ValidationError, observation, create_run, reference_decision
from button_game import DECISION_SCHEMA as BUTTON_SCHEMA
from guessing_game import DECISION_SCHEMA as GUESSING_SCHEMA
from providers import ModelAdapter, validate_provider
from server import Application, make_handler


class MockModelHandler(BaseHTTPRequestHandler):
    calls = []
    truncated = False
    delay = 0

    def log_message(self, *args):
        pass

    def reply(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/tags":
            self.reply({"models": [{"name": "mock-reasoner"}]})
        else:
            self.reply({"data": [{"id": "mock-reasoner"}]})

    def do_POST(self):
        value = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.calls.append(value)
        if self.delay:
            time.sleep(self.delay)
        obs = json.loads(value["messages"][-1]["content"])
        content = json.dumps({"action": "button_2", "justification": "Mock button choice"}
                             if obs.get("experiment") == "buttons" else
                             {"guess": 20, "justification": "Mock guessing choice"}
                             if obs.get("experiment") == "guessing" else reference_decision(obs))
        if self.path == "/api/chat":
            self.reply({"message": {"content": content}, "done": True,
                        "done_reason": "length" if self.truncated else "stop",
                        "prompt_eval_count": 123, "eval_count": 45})
        else:
            self.reply({"choices": [{"message": {"content": content},
                                     "finish_reason": "length" if self.truncated else "stop"}],
                        "usage": {"prompt_tokens": 123, "completion_tokens": 45}})


class AdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), MockModelHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:%d" % cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        MockModelHandler.calls.clear()
        MockModelHandler.truncated = False
        MockModelHandler.delay = 0

    def provider(self, kind):
        return validate_provider({"kind":kind, "base_url":self.url + ("/v1" if kind == "compatible" else ""), "model":"mock-reasoner"})

    def test_both_provider_contracts_and_usage(self):
        run = create_run({"population": 2})
        for kind in ("ollama", "compatible"):
            with self.subTest(kind=kind):
                adapter = ModelAdapter(self.provider(kind))
                self.assertTrue(adapter.test()["model_found"])
                decision, usage = adapter.decide(observation(run, "P01", 1), [])
                self.assertEqual(decision["action"], "wait")
                self.assertEqual(usage, {"input_tokens":123,"output_tokens":45})
                request = MockModelHandler.calls[-1]
                self.assertEqual(request["messages"][0]["role"], "system")
                self.assertFalse(request["stream"])
                self.assertNotIn("green_count", json.loads(request["messages"][-1]["content"]))
                self.assertEqual(request["format"]["type"], "object") if kind == "ollama" else self.assertEqual(request["response_format"]["type"], "json_schema")

    def test_incomplete_responses_are_never_used(self):
        MockModelHandler.truncated = True
        run = create_run({"population":1})
        for kind in ("ollama", "compatible"):
            with self.subTest(kind=kind), self.assertRaises(ValidationError):
                ModelAdapter(self.provider(kind)).decide(observation(run,"P01",1),[])

    def test_private_history_is_transmitted_only_for_subject(self):
        run = create_run({"population":3})
        obs = observation(run,"P02",1)
        history = [{"observation":obs,"decision":reference_decision(obs)}]
        ModelAdapter(self.provider("ollama")).decide(observation(run,"P02",2),history)
        messages = MockModelHandler.calls[-1]["messages"]
        self.assertEqual(len(messages),4)
        self.assertEqual(json.loads(messages[1]["content"])["prisoner_id"],"P02")
        self.assertEqual(messages[2]["role"],"assistant")

    def test_provider_validation_and_non_schema_fallback_modes(self):
        for data in [{"base_url":"ftp://host","model":"x"},{"base_url":"http://user:password@host","model":"x"},
                     {"base_url":"http://host?key=secret","model":"x"},{"base_url":"http://host","model":""}]:
            with self.assertRaises(ValidationError):
                validate_provider(data)
        obs = observation(create_run({"population":1}),"P01",1)
        for mode in ("json","prompt"):
            provider = self.provider("compatible")
            provider["output_format"] = mode
            decision, _ = ModelAdapter(provider).decide(obs,[])
            self.assertEqual(decision["action"],"leave")
            request = MockModelHandler.calls[-1]
            if mode == "prompt":
                self.assertNotIn("response_format",request)
            else:
                self.assertEqual(request["response_format"]["type"],"json_object")

    def test_ollama_context_preflight_prevents_silent_truncation(self):
        provider = self.provider("ollama")
        provider["context_length"] = 1024
        with self.assertRaises(ValidationError):
            ModelAdapter(provider).decide(observation(create_run({}),"P01",1),[])
        self.assertEqual(MockModelHandler.calls,[])


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = Application(Path(self.temp.name)/"test.sqlite3")
        self.server = ThreadingHTTPServer(("127.0.0.1",0),make_handler(self.app))
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:%d" % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self,path,body=None,origin=None):
        headers={}
        if body is not None: headers["Content-Type"]="application/json"
        if origin: headers["Origin"]=origin
        request=urllib.request.Request(self.url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        with urllib.request.urlopen(request,timeout=5) as response:
            return json.loads(response.read())

    def test_create_step_reload_archive_and_export(self):
        run=self.request("/api/runs",{"population":2,"name":"Two-prisoner test"})
        for _ in range(2): run=self.request("/api/runs/%s/step" % run["id"],{})
        self.assertEqual(run["status"],"completed")
        self.assertEqual(self.request("/api/runs/"+run["id"])["night"],2)
        self.assertEqual(self.request("/api/runs")["runs"][0]["released"],2)
        export=self.request("/api/runs/%s/export" % run["id"])
        self.assertEqual(len(export["histories"]["P01"]),2)
        restored=Application(Path(self.temp.name)/"test.sqlite3")
        self.assertEqual(restored.store.get_run(run["id"])["night"],2)

    def test_credentials_are_session_only_and_provider_snapshot_is_frozen(self):
        data={"name":"Test connection","kind":"ollama","base_url":"http://localhost:11434","model":"original","api_key":"test-secret-do-not-persist"}
        provider=self.request("/api/providers",data)
        self.assertTrue(provider["has_api_key"])
        self.assertNotIn("api_key",provider)
        run=self.request("/api/runs",{"mode":"model","provider_id":provider["id"]})
        self.assertEqual(run["prompt_version"],"island-v1")
        self.assertIn("one individual prisoner",run["system_prompt"])
        self.request("/api/providers",{**data,"id":provider["id"],"model":"replacement"})
        self.assertEqual(self.request("/api/runs/"+run["id"])["provider"]["model"],"original")
        raw=(Path(self.temp.name)/"test.sqlite3").read_bytes()
        self.assertNotIn(b"test-secret-do-not-persist",raw)
        self.assertNotIn("test-secret-do-not-persist",json.dumps(self.request("/api/runs/%s/export" % run["id"])))
        restored=Application(Path(self.temp.name)/"test.sqlite3")
        self.assertFalse(restored.provider_public(restored.store.get_provider(provider["id"]))["has_api_key"])

    def test_button_placeholder_persistence_archive_and_export(self):
        island = self.request("/api/runs", {"population": 1})
        run = self.request("/api/runs", {"game": "buttons", "population": 6, "button_2_count": 3})
        self.assertEqual(run["config"]["mode"], "placeholder")
        run = self.request("/api/runs/%s/step" % run["id"], {})
        self.assertEqual(run["result"]["survivors"], 3)
        self.assertEqual(run["result"]["deaths"], 3)
        self.assertEqual(run["usage"]["model_calls"], 0)
        self.assertEqual(self.request("/api/runs/" + run["id"])["result"], run["result"])
        archive = {r["id"]: r for r in self.request("/api/runs")["runs"]}
        self.assertEqual(archive[run["id"]]["game"], "buttons")
        self.assertEqual(archive[island["id"]]["game"], "island")
        export = self.request("/api/runs/%s/export" % run["id"])
        self.assertEqual(len(export["rounds"]), 1)
        self.assertEqual(len(export["histories"]["A01"]), 1)
        self.assertNotIn("scripted_choices", export["histories"]["A01"][0]["observation"])
        restored = Application(Path(self.temp.name) / "test.sqlite3")
        self.assertEqual(restored.store.get_run(run["id"])["result"], run["result"])

    def test_button_model_pipeline_uses_game_specific_prompt_and_schema(self):
        mock = ThreadingHTTPServer(("127.0.0.1", 0), MockModelHandler)
        thread = threading.Thread(target=mock.serve_forever, daemon=True)
        thread.start()
        MockModelHandler.truncated = False
        MockModelHandler.delay = 0
        MockModelHandler.calls.clear()
        try:
            for kind in ("ollama", "compatible"):
                with self.subTest(kind=kind):
                    base = "http://127.0.0.1:%d" % mock.server_port
                    provider = self.request("/api/providers", {"kind": kind, "base_url": base + ("/v1" if kind == "compatible" else ""), "model": "mock-reasoner"})
                    run = self.request("/api/runs", {"game": "buttons", "mode": "model", "provider_id": provider["id"], "population": 3})
                    self.assertEqual(run["prompt_version"], "buttons-v1")
                    self.assertIn("two-button", run["system_prompt"])
                    run = self.request("/api/runs/%s/step" % run["id"], {})
                    self.assertEqual(run["status"], "completed")
                    self.assertEqual(run["result"]["survivors"], 3)
                    self.assertEqual(run["result"]["button_2_votes"], 3)
                    self.assertEqual(run["usage"]["model_calls"], 3)
                    request = MockModelHandler.calls[-1]
                    schema = request["format"] if kind == "ollama" else request["response_format"]["json_schema"]["schema"]
                    self.assertEqual(schema, BUTTON_SCHEMA)
                    self.assertEqual(len(request["messages"]), 2)
                    self.assertNotIn("button_2_count", json.loads(request["messages"][-1]["content"]))
            self.assertEqual(len(MockModelHandler.calls), 6)
        finally:
            mock.shutdown()
            mock.server_close()
            thread.join()

    def test_guessing_round_persists_and_uses_game_specific_model_contract(self):
        scripted = self.request("/api/runs", {"game": "guessing", "population": 4, "seed": 7})
        completed = self.request("/api/runs/%s/step" % scripted["id"], {})
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(len(completed["players"]), 4)
        self.assertTrue(completed["result"]["winner_ids"])
        self.assertEqual(self.request("/api/runs/%s/export" % scripted["id"])["result"], completed["result"])
        self.assertEqual(self.request("/api/runs")["runs"][0]["game"], "guessing")
        restored = Application(Path(self.temp.name) / "test.sqlite3")
        self.assertEqual(restored.store.get_run(scripted["id"])["result"], completed["result"])

        mock = ThreadingHTTPServer(("127.0.0.1", 0), MockModelHandler)
        thread = threading.Thread(target=mock.serve_forever, daemon=True)
        thread.start()
        MockModelHandler.truncated = False
        MockModelHandler.delay = 0
        MockModelHandler.calls.clear()
        try:
            for kind in ("ollama", "compatible"):
                with self.subTest(kind=kind):
                    base = "http://127.0.0.1:%d" % mock.server_port
                    provider = self.request("/api/providers", {"kind": kind, "base_url": base + ("/v1" if kind == "compatible" else ""), "model": "mock-reasoner"})
                    run = self.request("/api/runs", {"game": "guessing", "mode": "model", "provider_id": provider["id"], "population": 3})
                    self.assertEqual(run["prompt_version"], "guessing-v1")
                    self.assertIn("simultaneous guessing game", run["system_prompt"])
                    run = self.request("/api/runs/%s/step" % run["id"], {})
                    self.assertEqual(run["result"]["winner_ids"], ["A01", "A02", "A03"])
                    self.assertEqual(run["usage"]["model_calls"], 3)
                    request = MockModelHandler.calls[-1]
                    schema = request["format"] if kind == "ollama" else request["response_format"]["json_schema"]["schema"]
                    self.assertEqual(schema, GUESSING_SCHEMA)
                    obs = json.loads(request["messages"][-1]["content"])
                    self.assertEqual(obs["experiment"], "guessing")
                    self.assertNotIn("scripted_guesses", obs)
            self.assertEqual(len(MockModelHandler.calls), 6)
        finally:
            mock.shutdown()
            mock.server_close()
            thread.join()

    def test_live_progress_does_not_publish_partial_decisions(self):
        mock = ThreadingHTTPServer(("127.0.0.1", 0), MockModelHandler)
        mock_thread = threading.Thread(target=mock.serve_forever, daemon=True)
        mock_thread.start()
        MockModelHandler.delay = 0.35
        MockModelHandler.truncated = False
        try:
            provider = self.request("/api/providers", {
                "kind": "ollama",
                "base_url": "http://127.0.0.1:%d" % mock.server_port,
                "model": "mock-reasoner",
            })
            run = self.request("/api/runs", {
                "population": 2, "mode": "model", "provider_id": provider["id"],
            })
            path = "/api/runs/%s" % run["id"]
            completed, errors = [], []

            def step():
                try:
                    completed.append(self.request(path + "/step", {}))
                except Exception as exc:
                    errors.append(exc)

            worker = threading.Thread(target=step, daemon=True)
            worker.start()
            progress = {"active": False}
            for _ in range(40):
                progress = self.request(path + "/progress")
                if progress["active"]:
                    break
                time.sleep(0.025)
            self.assertTrue(progress["active"])
            self.assertEqual(progress["total"], 2)
            self.assertLess(progress["completed"], 2)
            self.assertIn(progress["current_agent"], ("P01", "P02"))
            self.assertEqual(self.request(path)["night"], 0)
            worker.join(timeout=5)
            self.assertFalse(worker.is_alive())
            self.assertFalse(errors)
            self.assertEqual(completed[0]["night"], 1)
            self.assertEqual(self.request(path + "/progress"), {"active": False})
        finally:
            MockModelHandler.delay = 0
            mock.shutdown()
            mock.server_close()
            mock_thread.join()

    def test_invalid_truthful_announcement_and_cross_origin_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/runs",{"green_count":0})
        self.assertEqual(caught.exception.code,400)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/runs",{},origin="https://unrelated.example")
        self.assertEqual(caught.exception.code,403)

    def test_round_lock_rejects_simultaneous_steps(self):
        run=self.request("/api/runs",{})
        lock=self.app.run_lock(run["id"])
        lock.acquire()
        try:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request("/api/runs/%s/step" % run["id"],{})
            self.assertEqual(caught.exception.code,409)
        finally:
            lock.release()
        self.assertEqual(self.request("/api/runs/"+run["id"])["night"],0)

    def test_real_http_pipeline_with_both_mock_model_servers(self):
        mock=ThreadingHTTPServer(("127.0.0.1",0),MockModelHandler)
        thread=threading.Thread(target=mock.serve_forever,daemon=True)
        thread.start()
        MockModelHandler.truncated=False
        MockModelHandler.delay=0
        MockModelHandler.calls.clear()
        try:
            for kind in ("ollama","compatible"):
                with self.subTest(kind=kind):
                    base="http://127.0.0.1:%d" % mock.server_port
                    provider=self.request("/api/providers",{"kind":kind,"base_url":base+("/v1" if kind=="compatible" else ""),"model":"mock-reasoner"})
                    run=self.request("/api/runs",{"mode":"model","provider_id":provider["id"],"population":5,"max_nights":8})
                    for _ in range(5):
                        run=self.request("/api/runs/%s/step" % run["id"],{})
                    self.assertEqual(run["status"],"completed")
                    self.assertEqual(run["night"],5)
                    self.assertEqual(run["usage"]["model_calls"],25)
                    self.assertEqual(run["usage"]["input_tokens"],3075)
                    self.assertEqual(run["usage"]["output_tokens"],1125)
                    self.assertTrue(all(p["status"]=="released" for p in run["prisoners"]))
                    self.assertIsNone(run["benchmark"]["first_divergence"])
            self.assertEqual(len(MockModelHandler.calls),50)
        finally:
            mock.shutdown()
            mock.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
