"""A reasoning model in a voice session: its thoughts are never spoken, and
every question is answered aloud.

The case behind this file: on 08.10.2026 a Qwen3 4B build on Ollama, which
reports no thinking capability, wrote `<think>` and its whole reasoning into
the answer. The speech engine read the thought, the user spoke into it, and
the answer itself was never heard.
"""

import json

import pytest

from conftest import _chunk, text_reply
from lu_voice_loop.config import SessionConfig
from lu_voice_loop.thinking import (
    DIRECT_INSTRUCTION,
    NO_ANSWER_SENTENCE,
    SAY,
    THINK,
    ThoughtSplitter,
    without_thoughts,
)
from wire import client_message, message_frame, rtvi


def say(text: str) -> bytes:
    return message_frame(rtvi("send-text", {"content": text, "options": {"run_immediately": True, "audio_response": True}}))


def stream(*deltas: dict, finish: str = "stop") -> list[str]:
    return [_chunk(d) for d in deltas] + [_chunk({}, finish), "data: [DONE]\n\n"]


def thoughts(session) -> list[dict]:
    return [m for m in session.of_type("server-message") if m.get("type") == "thought"]


def thought_text(session) -> str:
    return "".join(m.get("text", "") for m in thoughts(session) if m.get("phase") == "text")


def spoken(session) -> str:
    return " ".join(m.get("text", "") for m in session.of_type("bot-tts-text"))


def written(session) -> str:
    return "".join(m.get("text", "") for m in session.of_type("bot-llm-text"))


def split(*pieces: str) -> list[tuple[str, str]]:
    splitter = ThoughtSplitter()
    out: list[tuple[str, str]] = []
    for piece in pieces:
        out += splitter.feed(piece)
    out += splitter.flush()
    joined: list[tuple[str, str]] = []
    for kind, text in out:
        if joined and joined[-1][0] == kind:
            joined[-1] = (kind, joined[-1][1] + text)
        else:
            joined.append((kind, text))
    return joined


# ── The splitter ──────────────────────────────────────────────────────


def test_a_thought_block_is_taken_out_of_the_answer():
    assert split("<think>\nOkay, the user said hi.\n</think>\n\nYo! How can I help?") == [
        (THINK, "\nOkay, the user said hi.\n"),
        (SAY, "\n\nYo! How can I help?"),
    ]


def test_a_tag_cut_anywhere_is_still_a_tag():
    whole = "<think>Let me see.</think>Paris."
    for cut in range(1, len(whole)):
        assert split(whole[:cut], whole[cut:]) == [(THINK, "Let me see."), (SAY, "Paris.")], cut
    assert split(*whole) == [(THINK, "Let me see."), (SAY, "Paris.")]


def test_a_thought_that_never_closes_stays_a_thought():
    assert split("<think>\nOkay, the user is asking if I can turn thinking off. Let me") == [
        (THINK, "\nOkay, the user is asking if I can turn thinking off. Let me"),
    ]


@pytest.mark.parametrize("text, thought", [
    ("<thinking>a</thinking>Yes.", "a"),
    ("<thought>a</thought>Yes.", "a"),
    ("<reasoning>a</reasoning>Yes.", "a"),
    ("<reflect>a</reflect>Yes.", "a"),
    ("<THINK>a</THINK>Yes.", "a"),
    ("<|channel>thought\na<channel|>Yes.", "\na"),
    ("<|channel|>thought a<|channel|>Yes.", " a"),
])
def test_the_tag_families_the_chat_knows(text, thought):
    assert split(text) == [(THINK, thought), (SAY, "Yes.")]


def test_a_gemma_thought_cut_anywhere_is_still_a_thought():
    # Gemma 4 sends the channel marker and the word behind it as tokens of
    # their own. The marker alone is a finished tag, so it used to be spoken
    # before the word arrived, and the whole thought after it.
    whole = "<|channel>thought\nLet me see.<channel|>Paris."
    assert split("<|channel>", "thought", "\n", "Let me see.", "<channel|>", "Paris.") == [
        (THINK, "\nLet me see."),
        (SAY, "Paris."),
    ]
    for cut in range(1, len(whole)):
        assert split(whole[:cut], whole[cut:]) == [(THINK, "\nLet me see."), (SAY, "Paris.")], cut
    assert split(*whole) == [(THINK, "\nLet me see."), (SAY, "Paris.")]


def test_a_channel_marker_is_never_spoken():
    assert split("<|channel>", "final", "\n", "Paris.") == [(SAY, "final\nParis.")]
    assert split("Paris.", "<channel|>") == [(SAY, "Paris.")]
    assert split("the", " thoughtful", " answer") == [(SAY, "the thoughtful answer")]


def test_a_closer_without_its_opener_is_not_spoken():
    assert split("So the answer is Paris.</think>Paris.") == [(SAY, "So the answer is Paris.Paris.")]


def test_text_with_an_angle_bracket_is_not_swallowed():
    assert split("Three is < four, ", "and five > two.") == [(SAY, "Three is < four, and five > two.")]
    assert split("a <b") == [(SAY, "a <b")]


def test_a_finished_text_loses_its_thoughts():
    assert without_thoughts("<think>\nhm\n</think>\n\nThe user asked about Paris.") == "The user asked about Paris."
    assert without_thoughts("Plain.") == "Plain."
    assert without_thoughts(None) is None


# ── The session ───────────────────────────────────────────────────────


async def test_an_inline_thought_is_shown_and_never_spoken(harness):
    harness.llm.script = lambda body: stream(
        {"role": "assistant", "content": "<think>\nOkay, the user said yo. "},
        {"content": "Keep it short.\n</think>\n\n"},
        {"content": "Yo, loud and clear!"},
    )
    async with harness.session() as s:
        await s.send(say("Yo brother"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Yo, loud and clear!"
        assert written(s) == "Yo, loud and clear!"
        assert thought_text(s) == "\nOkay, the user said yo. Keep it short.\n"
        phases = [m["phase"] for m in thoughts(s)]
        assert phases[0] == "start" and phases[-1] == "end"
        assert thoughts(s)[-1]["cut"] is False and thoughts(s)[-1]["secs"] >= 0
        await s.send(say("And again"))
        await s.wait_for("bot-stopped-speaking", count=2)
    # The thought is not part of the conversation the model reads next.
    second = harness.llm.requests[1]["messages"]
    assert all("Okay, the user said yo" not in str(m.get("content")) for m in second)
    assert {"role": "assistant", "content": "Yo, loud and clear!"} in second


@pytest.mark.parametrize("field", ["reasoning", "reasoning_content"])
async def test_a_thought_in_its_own_field_is_shown_and_never_spoken(harness, field):
    harness.llm.script = lambda body: stream(
        {"role": "assistant", field: "The user greets me. "},
        {field: "I greet back."},
        {"content": "Hello there."},
    )
    async with harness.session() as s:
        await s.send(say("Hello"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Hello there."
        assert thought_text(s) == "The user greets me. I greet back."


async def test_an_empty_thought_block_is_no_thought(harness):
    harness.llm.script = lambda body: stream({"role": "assistant", "content": "<think>\n\n</think>\n\nSure."})
    async with harness.session() as s:
        await s.send(say("Hello"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Sure."
        assert thoughts(s) == []


async def test_a_thought_past_the_set_length_is_cut_and_the_turn_asked_again_without_thinking(harness):
    long_thought = "The user wants something. " * 40

    def script(body):
        if len(harness.llm.requests) == 1:
            # Never gets out of the thought, as on 08.10.2026.
            return stream({"role": "assistant", "content": "<think>\n"}, *[{"content": long_thought} for _ in range(8)])
        return text_reply("Here is the short answer.")

    harness.llm.script = script
    config = harness.config(thinking={"wanted": True, "budget_tokens": 64, "direct_extra": {"reasoning_effort": "none"}})
    async with harness.session(config) as s:
        await s.send(say("Can you turn thinking off?"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Here is the short answer."
        end = [m for m in thoughts(s) if m["phase"] == "end"]
        assert len(end) == 1 and end[0]["cut"] is True
        assert "The user wants something." not in spoken(s)
    first, second = harness.llm.requests
    assert "reasoning_effort" not in first
    assert not first["messages"][0]["content"].endswith(DIRECT_INSTRUCTION)
    assert second["reasoning_effort"] == "none"
    assert second["messages"][0]["content"] == "You are a test assistant.\n\n" + DIRECT_INSTRUCTION
    # Same question, nothing of the cut thought in it.
    assert second["messages"][1:] == first["messages"][1:]


async def test_thinking_within_the_set_length_is_left_alone(harness):
    harness.llm.script = lambda body: stream(
        {"role": "assistant", "reasoning": "Short thought."}, {"content": "Done."},
    )
    async with harness.session(harness.config(thinking={"wanted": True, "budget_tokens": 64})) as s:
        await s.send(say("Hello"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Done."
    assert len(harness.llm.requests) == 1


async def test_an_answer_that_never_came_is_asked_for_again(harness):
    # The thought used up the output limit of the server: the stream ends
    # with "length" and without a word of answer.
    def script(body):
        if len(harness.llm.requests) == 1:
            return stream({"role": "assistant", "reasoning": "Let me think about this for a while"}, finish="length")
        return text_reply("Paris.")

    harness.llm.script = script
    async with harness.session() as s:
        await s.send(say("What is the capital of France?"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Paris."
    assert len(harness.llm.requests) == 2
    assert harness.llm.requests[1]["messages"][0]["content"].endswith(DIRECT_INSTRUCTION)


async def test_a_model_that_says_nothing_twice_still_ends_in_a_spoken_sentence(harness):
    harness.llm.script = lambda body: stream({"role": "assistant", "content": "<think>\nhm, hm, hm"})
    async with harness.session() as s:
        await s.send(say("Hello?"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == NO_ANSWER_SENTENCE
    assert len(harness.llm.requests) == 2


async def test_a_refused_thinking_field_is_asked_again_with_the_safe_fields(harness):
    # Ollama answers 400 "does not support thinking" to an effort level for a
    # model without the capability. The session used to end there.
    harness.llm.status = lambda body: 400 if body.get("reasoning_effort") == "low" else 200
    config = harness.config(
        llm={"base_url": harness.llm_url, "model": "fake", "extra": {"reasoning_effort": "low"}},
        thinking={"direct_extra": {"reasoning_effort": "none"}},
    )
    async with harness.session(config) as s:
        await s.send(say("Hello"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Hello there."
    first, second = harness.llm.requests
    assert first["reasoning_effort"] == "low"
    assert second["reasoning_effort"] == "none"
    assert second["messages"][0]["content"].endswith(DIRECT_INSTRUCTION)


async def test_a_tool_call_after_a_thought_is_an_answer(harness):
    def script(body):
        if not any(m.get("role") == "tool" for m in body["messages"]):
            call = {"index": 0, "id": "call_1", "type": "function", "function": {"name": "get_current_time", "arguments": "{}"}}
            return [_chunk({"role": "assistant", "content": "<think>I need the time.</think>"}),
                    _chunk({"tool_calls": [call]}), _chunk({}, "tool_calls"), "data: [DONE]\n\n"]
        return text_reply("It is noon.")

    harness.llm.script = script
    async with harness.session() as s:
        await s.send(say("What time is it?"))
        call = await s.wait_for("llm-function-call-in-progress")
        await s.send(message_frame(rtvi("llm-function-call-result", {
            "function_name": "get_current_time", "tool_call_id": call["tool_call_id"], "arguments": {},
            "result": {"status": "completed", "text": "12:00"},
        })))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "It is noon."
        assert thought_text(s) == "I need the time."
    assert len(harness.llm.requests) == 2


async def test_the_summary_and_the_prewarm_do_not_inherit_the_second_try(harness):
    def script(body):
        if len(harness.llm.requests) == 1:
            return stream({"role": "assistant", "content": "<think>" + "x" * 2000})
        return text_reply("Short.")

    harness.llm.script = script
    async with harness.session(harness.config(thinking={"wanted": True, "budget_tokens": 64})) as s:
        await s.send(say("One"))
        await s.wait_for("bot-stopped-speaking")
        await s.send(say("Two"))
        await s.wait_for("bot-stopped-speaking", count=2)
    third = harness.llm.requests[2]
    assert third["messages"][0]["content"] == "You are a test assistant."


def test_the_app_cannot_overwrite_the_request_through_the_second_try():
    base = {"llm": {"base_url": "http://127.0.0.1:1/v1", "model": "m"}}
    assert SessionConfig(**base).thinking.budget_tokens is None
    assert SessionConfig(**base, thinking={"budget_tokens": 512}).thinking.budget_tokens == 512
    with pytest.raises(ValueError):
        SessionConfig(**base, thinking={"direct_extra": {"messages": []}})
    with pytest.raises(ValueError):
        SessionConfig(**base, thinking={"budget_tokens": 8})
    assert json.loads(SessionConfig(**base, thinking={"direct_extra": {"reasoning_effort": "none"}}).model_dump_json())["thinking"]["direct_extra"] == {"reasoning_effort": "none"}


async def test_with_thinking_off_a_model_that_thinks_anyway_is_asked_the_second_way_from_then_on(harness):
    # The Qwen3 4B build of 08.10.2026: no capability on the server, so the
    # off switch of the API does nothing. One turn finds out, the rest of the
    # session starts with the instruction the model does follow.
    def script(body):
        if body["messages"][0]["content"].endswith(DIRECT_INSTRUCTION):
            return stream({"role": "assistant", "content": "<think>\n\n</think>\n\nDirect answer."})
        return stream({"role": "assistant", "content": "<think>\nOkay, the user wants " + "more " * 300})

    harness.llm.script = script
    async with harness.session() as s:
        await s.send(say("One"))
        await s.wait_for("bot-stopped-speaking")
        await s.send(say("Two"))
        await s.wait_for("bot-stopped-speaking", count=2)
        await s.send(say("Three"))
        await s.wait_for("bot-stopped-speaking", count=3)
        assert spoken(s).count("Direct answer.") == 3
        assert "the user wants" not in spoken(s)
    # Two requests for the first turn, one for each turn after it.
    assert len(harness.llm.requests) == 4
    assert all(body["messages"][0]["content"].endswith(DIRECT_INSTRUCTION) for body in harness.llm.requests[1:])


async def test_a_server_that_refuses_every_thinking_field_is_asked_without_them(harness):
    harness.llm.status = lambda body: 400 if "reasoning_effort" in body else 200
    config = harness.config(
        llm={"base_url": harness.llm_url, "model": "fake", "temperature": 0.5, "extra": {"reasoning_effort": "low"}},
        thinking={"wanted": True, "direct_extra": {"reasoning_effort": "none"}},
    )
    async with harness.session(config) as s:
        await s.send(say("Hello"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Hello there."
    assert [body.get("reasoning_effort") for body in harness.llm.requests] == ["low", "none", None]
    assert harness.llm.requests[2]["temperature"] == 0.5


async def test_the_thinking_switch_works_in_a_running_session(harness):
    config = harness.config(llm={"base_url": harness.llm_url, "model": "fake", "extra": {"reasoning_effort": "none", "seed": 7}})
    async with harness.session(config) as s:
        await s.send(say("One"))
        await s.wait_for("bot-stopped-speaking")
        await s.send(client_message("thinking", {"wanted": True, "budget_tokens": 512, "extra": {}, "direct_extra": {"reasoning_effort": "none"}}))
        await s.send(say("Two"))
        await s.wait_for("bot-stopped-speaking", count=2)
        # A message that tries to replace the conversation changes nothing.
        await s.send(client_message("thinking", {"wanted": False, "extra": {"messages": []}}))
        await s.send(client_message("thinking", {"wanted": False, "extra": {"reasoning_effort": "none"}}))
        await s.send(say("Three"))
        await s.wait_for("bot-stopped-speaking", count=3)
    one, two, three = harness.llm.requests
    assert one["reasoning_effort"] == "none" and three["reasoning_effort"] == "none"
    assert "reasoning_effort" not in two
    # Fields that are not about thinking stay.
    assert one["seed"] == two["seed"] == three["seed"] == 7


async def test_the_app_changes_which_tools_the_model_sees_in_a_running_session(harness):
    other = {"type": "function", "function": {"name": "file_read", "description": "Reads a file.", "parameters": {"type": "object", "properties": {}}}}
    config = harness.config(tools=[harness.config()["tools"][0], other], active_tools=["file_read"])
    async with harness.session(config) as s:
        await s.send(say("One"))
        await s.wait_for("bot-stopped-speaking")
        await s.send(client_message("session-tools", {"names": [], "system_prompt": "No tools now."}))
        await s.send(say("Two"))
        await s.wait_for("bot-stopped-speaking", count=2)
        # A name the session never had is not shown, whatever the message says.
        await s.send(client_message("session-tools", {"names": ["get_current_time", "rm_rf"], "system_prompt": "Tools again."}))
        await s.send(say("Three"))
        await s.wait_for("bot-stopped-speaking", count=3)
    one, two, three = harness.llm.requests
    names = lambda body: [t["function"]["name"] for t in body.get("tools") or []]
    assert names(one) == ["file_read"]
    assert names(two) == [] and two["messages"][0]["content"] == "No tools now."
    assert names(three) == ["get_current_time"] and three["messages"][0]["content"] == "Tools again."


def test_active_tools_must_be_tools_of_the_session():
    base = {"llm": {"base_url": "http://127.0.0.1:1/v1", "model": "m"}}
    with pytest.raises(ValueError):
        SessionConfig(**base, active_tools=["nope"])


# ── A request limit ───────────────────────────────────────────────────


LIMIT_SENTENCE = "Fake is at its request limit right now. Please send your message again in about 12 seconds, or pick a different model. Nothing was charged."


@pytest.mark.parametrize("refusal, said", [
    # LU Cloud: the sentence is the `error` field itself.
    (json.dumps({"error": LIMIT_SENTENCE, "code": "model_rate_limited", "retry_after_seconds": 12}), LIMIT_SENTENCE),
    # Most other servers: an object with a message.
    (json.dumps({"error": {"message": "Rate limit reached for fake. Try again in 12s."}}), "Rate limit reached for fake. Try again in 12s."),
    # No words at all.
    ("", ""),
])
async def test_a_request_limit_reaches_the_app_as_the_servers_own_sentence(harness, refusal, said):
    harness.llm.status = 429
    harness.llm.refusal = refusal
    async with harness.session() as s:
        await s.send(say("Hello"))
        error = await s.wait_for("error", timeout=30.0)
        assert error.get("fatal") is False
        assert error.get("error") == ("Request limit: " + said)
        # The session is still there: the next question is answered.
        harness.llm.status = 200
        await s.send(say("Hello again"))
        await s.wait_for("bot-stopped-speaking")
        assert spoken(s).strip() == "Hello there."
