# Common Ground

A local agent laboratory with three experiments: the green-eyed prisoners puzzle, the two-button survival dilemma, and the two-thirds-of-the-average guessing game. The dashboard includes private agent views, simultaneous decisions, scripted modes, model adapters, SQLite persistence, a run archive, comparison, JSON exports, and replay.

## Start

Requires Python 3.9 or later; there are no Python packages to install. From this folder, run `python server.py --open` on Windows or `python3 server.py --open` on macOS and Linux. On Windows, you can double-click `start.cmd` instead. The application listens only on `http://127.0.0.1:8765`. Keep its server process running while using the dashboard. If a browser tab says it cannot reach Common Ground, start the server again and refresh the tab. Open the app through the server, not `web/index.html` directly. Close the terminal or press Ctrl+C to stop a server you started there. Local runs and model connections are saved in `data/lab.sqlite3`, which Git ignores.

## First experiment

Start with the default five green-eyed prisoners and the public announcement. Choose **Step a night** or **Run experiment**. The logical reference should release everyone together on night five. Reference mode is scripted mathematics, not an AI reasoning result, and makes no model requests.

Inspect a prisoner to view its permitted observations and stated decision justification. The observer view contains ground truth; the prisoner's own eye colour is omitted from its observation payload. Use the timeline slider to replay recorded nights. Every created run and completed night is saved to `data/lab.sqlite3` automatically. Open **Run archive** to resume a paused run, compare two experiments, or open one and export its full record.

## Button dilemma

Use the experiment tabs above the dashboard to switch to **Button dilemma**. It starts with five scripted placeholders and three Button 2 votes. Adjust the population and prepared vote split, or select a majority, minority, unanimous, or exact-tie scenario. Choose **Run the vote** to reveal all ballots and resolve the outcome together.

- Button 1 voters always survive.
- If more than half choose Button 2, everyone survives.
- Otherwise Button 2 voters die. By default, an exact tie is not a majority: Button 1 voters survive and Button 2 voters die.
- If everyone chooses Button 1, everyone survives too.

The alternative **Everyone survives a tie** setting is an explicit variation; it is not the default rule. Placeholder choices are prepared assignments, not AI decisions. The assignment seed determines who receives each button. These runs make no model calls.

Inspect participants to read their permitted observations and assignment notes. Use the replay slider to switch between sealed ballots and the final result. Saved runs can be reopened, exported, and compared with other button runs. Island runs remain available in the same archive; comparisons require two runs of the same game.

This is a one-shot collective-choice experiment, with no single ideal reasoning benchmark. All participants know the population, rules, and tie policy. Agents cannot communicate or see any peer's current vote. The observer can inspect the completed group outcome. If a future model call fails, no partial vote is applied.

## Two-thirds game

Choose **Two-thirds game** from the experiment tabs. Each participant privately picks one whole number from 0 to 100. After every guess is collected, the app computes their average, multiplies it by 2/3, and names the participant or participants closest to that target. Exact closest-distance ties share the win. Each person's own guess contributes to the average.

The default seeded random mode draws one uniform whole-number guess per participant and makes no model calls. It demonstrates the rules; it is not a strategic baseline. Select **Independent AI agents** to have each connected model instance choose from the rules and population size, without seeing any peer's guess. Requests are sequential for local memory use, while guesses are resolved together after all responses validate. An invalid or failed response leaves the round unapplied.

The result view shows the average, target, winners, and guesses. The replay slider returns to the sealed view. Runs can be reopened, exported, and compared with other two-thirds runs. This is a single simultaneous round; repeat the experiment to compare strategies or models. The game has no universal best guess without assumptions about what the other participants will choose, though repeated elimination of high guesses points toward zero.

## Local model

The reference and placeholder experiments run without a model. To use independent AI agents, install [Ollama](https://ollama.com/download), then pull a model such as `qwen3:4b-instruct` or the faster `qwen3:1.7b`. In **Models**, add an Ollama connection with server `http://localhost:11434` and the exact model name, use **Test connection**, then choose **Use model**. For `qwen3:1.7b`, set **Thinking** to **Off** under generation settings. The dashboard opens the current game with Independent AI agents selected. Start with two or three agents on a CPU-only machine: each agent makes a separate request. Local inference requires no paid API key.

The 1.7B model is the speed option. On one CPU laptop, warmed-up sample decisions took about 8–11 seconds on early rounds and 28 seconds on a history-heavy night; comparable 4B calls took roughly 20–60 seconds. These are sample measurements, not guaranteed run times. The fast model missed a simple one-prisoner case in testing; the 4B model also missed that case in one test. Compare both against the logical reference when reasoning quality matters. Existing runs retain their selected model; choose the fast model when starting a new run.

Model files and connections are local to each computer and are not included in the repository. Other Ollama models or a compatible chat-completions server (LM Studio commonly uses `http://localhost:1234/v1`) can use the same experiment engine. The adapter supports enforced JSON schema, JSON mode, or prompt-only formatting. Every response is validated; invalid or incomplete responses stop the run rather than inventing an action. Server-specific compatibility may require changing the generation or output-format settings.

**Test connection** lists models without generating a response. Once connected, create a new experiment and select **Independent AI agents**. Island prisoners have separate full conversation histories; button and two-thirds participants each receive one isolated decision request. Each game uses its own prompt and validated action schema. Agents choose their own actions, with no prepared choices sent to the model. Requests are processed sequentially to keep local memory use modest, but all choices are resolved simultaneously after every participant has returned a valid decision.

During a model round, the control bar shows how many agents have answered and the elapsed time. The night or vote advances only after every agent has answered; partial choices stay hidden. Running two model experiments at once makes their requests compete for the same local model and can make both slower.

API keys are held in server memory only, never persisted or exported, and must be re-entered after a restart. A hosted server may charge for model inference. Night limits, request limits, output-token limits, and timeouts are configurable. Connection settings are frozen in each run, so later model edits do not silently change existing experiments.

Ollama receives an explicit context length. A conservative preflight checks growing history against that context setting and interrupts a run rather than intentionally truncating it; it is an estimate, not an exact tokenizer. For compatible servers, configure enough context in the model server itself and ensure it reports context-overflow errors instead of silently trimming history. Small local models are experiments, not guaranteed solvers of the green-eyed puzzle.

## Island experimental assumptions

The ideal benchmark assumes complete visibility, truthful publicly witnessed announcements, simultaneous nightly decisions, perfect logicians, and common knowledge that everyone leaves at the first justified opportunity. AI agents are instructed to follow those assumptions; whether they do so is an experimental outcome.

With `G` green-eyed prisoners, public lower bound `q`, and announcement delay `d`, the ideal release night is `d + G - q + 1`. No announcement supplies no common premise and justifies no departures. Green-eyed agents leaving prematurely can survive but violate the certainty rule. Non-green attempts are recorded as killed.

The lab records the first action divergence from the ideal history. Later rounds remain observable but are not treated as though the original ideal history still holds. Decision justifications are model reports, not direct observations of internal reasoning. The run's random seed fixes the colour assignment; fresh model outputs may still vary.

AI runs also freeze the exact system instruction and prompt version in their record. Evaluator annotations are removed before private history reaches any model adapter. The observer's full export contains ground truth for analysis, while model requests contain only permitted observations and that prisoner's own structured decisions.

If a model fails partway through a night, no environmental action or private-history update from that night is committed. Staged decisions are preserved in the interrupted run's export. Earlier calls may have incurred inference charges; requests are not retried automatically. Create a fresh run after fixing the connection or settings.

The reference stops after eligible prisoners leave because the ideal policy has reached its fixed point. AI runs continue until all prisoners depart or the configured night/request limit is reached. Finite no-announcement runs demonstrate behaviour over the tested horizon, not a claim about infinite time.

## Verify

Run `python -m unittest discover -s tests -v`. Tests cover all three games: private observations, canonical and mixed island populations, announcements, button majorities/minorities/ties/unanimous votes, exact two-thirds targets and ties, simultaneous decisions, interrupted rounds, request limits, per-game provider contracts, local persistence, legacy island records, and HTTP endpoints. Mock model servers require no installed model or paid API key.

All frontend assets are local. The app has no analytics, remote font dependencies, or deployment requirement.
