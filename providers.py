"""Small adapters for Ollama and OpenAI-compatible local/remote chat servers."""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid

from engine import ValidationError, integer


DECISION_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "action": {"type": "string", "enum": ["wait", "leave"]},
        "possible_own_colours": {"type": "array", "items": {"type": "string", "enum": ["green", "not_green"]}},
        "justification": {"type": "string"},
    },
    "required": ["action", "possible_own_colours", "justification"],
}

SYSTEM_PROMPT = """You are one individual prisoner in a fictional logic experiment. You can see the other prisoners' eyes but never your own. Eye colours are either green or not_green. You may request release at night. Green-eyed prisoners are released; others are killed. Your objective is to leave at the first night when you can logically establish with absolute certainty that you have green eyes. Never guess based on probability.
All prisoners know these rules. They are perfect logicians who want to leave as soon as they can establish their eligibility with certainty, and this is common knowledge. Everyone sees the others at morning head count. There is no speech, messaging, gestures, or other communication between prisoners. Night decisions are simultaneous; you observe departures only at the following morning head count. A publicly witnessed announcement, if present in your observations, is truthful and everyone knows everyone heard it.
Use only your own supplied observations and private history. The actual colour of your own eyes and the total eligible count have not been supplied to you. Do not assume a particular population, colour distribution, announcement, or answer from a remembered puzzle. Choose a decision for the current night, not a plan for all prisoners. Return only JSON matching the supplied schema. Give a concise decision justification, not a lengthy reasoning transcript.
Schema: """ + json.dumps(DECISION_SCHEMA)


def validate_provider(data, existing_id=None):
    kind = data.get("kind", "ollama")
    if kind not in ("ollama", "compatible"):
        raise ValidationError("Choose Ollama or an OpenAI-compatible chat server.")
    url = str(data.get("base_url", "")).strip().rstrip("/")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValidationError("Enter an HTTP(S) server address without credentials, query parameters, or fragments.")
    model = str(data.get("model", "")).strip()
    if not model or len(model) > 200:
        raise ValidationError("Enter a model name (up to 200 characters).")
    name = str(data.get("name", "")).strip()[:80] or model
    try:
        temperature = float(data.get("temperature", 0))
        if not 0 <= temperature <= 2:
            raise ValueError()
    except (TypeError, ValueError):
        raise ValidationError("Temperature must be between 0 and 2.")
    output_format = data.get("output_format", "schema")
    if output_format not in ("schema", "json", "prompt"):
        raise ValidationError("Choose schema, JSON mode, or prompt-only output.")
    thinking = data.get("thinking", "default")
    if thinking not in ("default", "on", "off"):
        raise ValidationError("Choose default, on, or off thinking.")
    return {"id": existing_id or uuid.uuid4().hex, "name": name, "kind": kind,
            "base_url": url, "model": model, "temperature": temperature,
            "max_output_tokens": integer(data.get("max_output_tokens", 2048), "Output token limit", 128, 32000),
            "context_length": integer(data.get("context_length", 8192), "Context length", 1024, 131072),
            "timeout": integer(data.get("timeout", 180), "Request timeout", 5, 600),
            "output_format": output_format, "thinking": thinking}


class ModelAdapter:
    def __init__(self, config, api_key="", system_prompt=SYSTEM_PROMPT, decision_schema=DECISION_SCHEMA):
        self.config = config
        self.api_key = api_key
        self.system_prompt = system_prompt
        self.decision_schema = decision_schema

    def request(self, path, payload=None, timeout=None):
        endpoint = self.config["base_url"] + path
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(endpoint, data=body, headers=headers)
        # Local model calls should not accidentally use an ambient HTTP proxy.
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.hostname in ("localhost", "127.0.0.1", "::1"):
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        else:
            opener = urllib.request.build_opener()
        try:
            with opener.open(request, timeout=timeout or self.config["timeout"]) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise ValidationError("The model server returned an unexpectedly large response.")
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise ValidationError("Model server returned HTTP %d. Check the model name, credentials, and output-format support." % exc.code)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            text = str(exc)
            if self.api_key:
                text = text.replace(self.api_key, "[redacted]")
            raise ValidationError("Could not reach the model server: " + text[:300])
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValidationError("The model server did not return a JSON API response.")

    def test(self):
        data = self.request("/api/tags" if self.config["kind"] == "ollama" else "/models", timeout=10)
        values = data.get("models", []) if self.config["kind"] == "ollama" else data.get("data", [])
        models = [m.get("name", m.get("id", "")) for m in values]
        return {"reachable": True, "models": models,
                "model_found": self.config["model"] in models,
                "message": "Server connected. Model found." if self.config["model"] in models else "Server connected; the selected model was not listed. Check its identifier."}

    def decide(self, obs, history):
        messages = [{"role": "system", "content": self.system_prompt}]
        for entry in history:
            messages.append({"role": "user", "content": json.dumps(entry["observation"])})
            messages.append({"role": "assistant", "content": json.dumps(entry["decision"])})
        messages.append({"role": "user", "content": json.dumps(obs)})
        cfg = self.config
        if cfg["kind"] == "ollama":
            # A conservative check avoids silently discarding old private history.
            estimate = sum(len(m["content"].encode("utf-8")) for m in messages)
            if estimate > (cfg["context_length"] - cfg["max_output_tokens"]) * 2:
                raise ValidationError("Private history is approaching the configured context limit. Increase context length or start a shorter experiment; history was not silently truncated.")
            payload = {"model": cfg["model"], "messages": messages, "stream": False,
                       "options": {"temperature": cfg["temperature"], "num_predict": cfg["max_output_tokens"], "num_ctx": cfg["context_length"]},
                       "keep_alive": "10m"}
            if cfg["output_format"] != "prompt":
                payload["format"] = self.decision_schema if cfg["output_format"] == "schema" else "json"
            if cfg["thinking"] != "default":
                payload["think"] = cfg["thinking"] == "on"
            data = self.request("/api/chat", payload)
            if data.get("done_reason") == "length" or data.get("done") is not True:
                raise ValidationError("The model response was incomplete. Increase the output token limit; no decision round was committed.")
            content = data.get("message", {}).get("content", "")
            usage = {"input_tokens": data.get("prompt_eval_count", 0), "output_tokens": data.get("eval_count", 0)}
        else:
            payload = {"model": cfg["model"], "messages": messages, "stream": False,
                       "temperature": cfg["temperature"], "max_tokens": cfg["max_output_tokens"]}
            if cfg["output_format"] == "schema":
                payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "agent_decision", "strict": True, "schema": self.decision_schema}}
            elif cfg["output_format"] == "json":
                payload["response_format"] = {"type": "json_object"}
            data = self.request("/chat/completions", payload)
            choices = data.get("choices", [])
            if not choices:
                raise ValidationError("The model server returned no decision.")
            if choices[0].get("finish_reason") not in ("stop", None):
                raise ValidationError("The model response was incomplete or refused. No decision round was committed.")
            content = choices[0].get("message", {}).get("content", "")
            u = data.get("usage")
            usage = {"input_tokens": u.get("prompt_tokens", 0), "output_tokens": u.get("completion_tokens", 0)} if isinstance(u, dict) else None
        if not isinstance(content, str):
            raise ValidationError("The model returned no textual decision.")
        cleaned = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
        if cleaned.startswith("```") and cleaned.endswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)[:-3].strip()
        try:
            decision = json.loads(cleaned)
        except json.JSONDecodeError:
            raise ValidationError("The model returned an invalid JSON decision. Its action was not guessed or repaired.")
        return decision, usage
