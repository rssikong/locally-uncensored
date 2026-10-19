"""What a model thinks is not what it says.

A reasoning model sends its thoughts in one of two ways. A server that knows
the model separates them into a field of their own (`reasoning` on Ollama,
`reasoning_content` on llama.cpp and most cloud endpoints). A server that does
not know the model passes them through inside the answer, wrapped in tags.
Seen on 08.10.2026 with a Qwen3 4B build on Ollama that reports no thinking
capability: every answer began with `<think>`, the speech engine read the
whole thought aloud, and the user who spoke into it never heard the answer.

Nothing in this module is spoken. The splitter takes the tags out of the
stream while it runs, the turn keeps count of how much was thought, and the
session decides what to do when a thought runs too long or an answer never
comes (see `ChatModelService` in pipeline.py).
"""

import re
import time
from dataclasses import dataclass, field

# The tag families the chat of the app knows (src/lib/thinking-stripper.ts).
_NAMED = ("think", "thinking", "thought", "reasoning", "reflect", "deepthink")
_OPEN = re.compile(r"<(%s)>|<\|?channel\|?>\s*thought\b" % "|".join(_NAMED), re.IGNORECASE)
_CHANNEL_CLOSE = re.compile(r"</?\|?channel\|?>", re.IGNORECASE)
# A channel marker whose word has not arrived yet. The marker and the word
# behind it are tokens of their own, so the marker alone decides nothing.
_CHANNEL_PENDING = re.compile(r"<\|?channel\|?>\s*(?:t(?:h(?:o(?:u(?:g(?:ht?)?)?)?)?)?)?$", re.IGNORECASE)
# A closer whose opener was part of the prompt and never came over the wire,
# and a channel marker with no thought behind it. Neither is a word.
_STRAY = re.compile(r"</(%s)>|</?\|?channel\|?>" % "|".join(_NAMED), re.IGNORECASE)
# The longest piece of a tag that is held back until the rest of it arrives.
_MAX_TAG_CHARS = 24

SAY = "say"
THINK = "think"


def _held_tail(text: str) -> int:
    """How many characters at the end of `text` may be the start of a tag."""
    pending = _CHANNEL_PENDING.search(text)
    if pending is not None:
        return len(text) - pending.start()
    at = text.rfind("<")
    if at == -1 or len(text) - at > _MAX_TAG_CHARS or ">" in text[at:]:
        return 0
    return len(text) - at


class ThoughtSplitter:
    """Splits a stream of answer text into what is said and what is thought.

    Text arrives in pieces of any size, so a tag can be cut anywhere. What may
    be the beginning of a tag is held back until the next piece decides it.
    """

    def __init__(self):
        self._buffer = ""
        self._close: re.Pattern | None = None

    @property
    def thinking(self) -> bool:
        return self._close is not None

    def feed(self, text: str) -> list[tuple[str, str]]:
        self._buffer += text
        out: list[tuple[str, str]] = []
        while self._buffer:
            if self._close is None:
                found = _OPEN.search(self._buffer)
                if found is None:
                    keep = _held_tail(self._buffer)
                    said = self._buffer[: len(self._buffer) - keep]
                    self._buffer = self._buffer[len(said):]
                    if said:
                        out.append((SAY, said))
                    break
                if found.start():
                    out.append((SAY, self._buffer[: found.start()]))
                name = found.group(1)
                self._close = re.compile("</%s>" % re.escape(name), re.IGNORECASE) if name else _CHANNEL_CLOSE
                self._buffer = self._buffer[found.end():]
            else:
                found = self._close.search(self._buffer)
                if found is None:
                    keep = _held_tail(self._buffer)
                    thought = self._buffer[: len(self._buffer) - keep]
                    self._buffer = self._buffer[len(thought):]
                    if thought:
                        out.append((THINK, thought))
                    break
                if found.start():
                    out.append((THINK, self._buffer[: found.start()]))
                self._close = None
                self._buffer = self._buffer[found.end():]
        return _without_strays(out)

    def flush(self) -> list[tuple[str, str]]:
        """The stream is over: what was held back is text after all."""
        rest, self._buffer = self._buffer, ""
        kind = THINK if self._close is not None else SAY
        self._close = None
        return _without_strays([(kind, rest)]) if rest else []


def _without_strays(pieces: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """What is said, without the markers that are left when a thought is not."""
    cleaned = [(kind, _STRAY.sub("", piece) if kind == SAY else piece) for kind, piece in pieces]
    return [(kind, piece) for kind, piece in cleaned if piece]


def without_thoughts(text: str | None) -> str | None:
    """A finished text without its thought blocks, for an answer that is not streamed."""
    if not text:
        return text
    splitter = ThoughtSplitter()
    pieces = splitter.feed(text) + splitter.flush()
    return "".join(piece for kind, piece in pieces if kind == SAY).strip()


class ThinkingOverBudget(Exception):
    """The model thought longer than the session allows and has not answered."""


@dataclass
class ThinkingTurn:
    """One request to the model: how much it thought, and whether it answered."""

    # True for the second try: asked to answer without thinking, and not cut off.
    direct: bool = False
    # True for the last try: without any of the thinking fields, for a server
    # that refuses them.
    bare: bool = False
    # How many characters of thought are allowed before the turn is asked again.
    budget_chars: int | None = None
    thought_chars: int = 0
    said: bool = False
    tool_called: bool = False
    thought_started: float | None = None
    thought_open: bool = False
    splitter: ThoughtSplitter = field(default_factory=ThoughtSplitter)

    def thought(self, text: str) -> None:
        if self.thought_started is None:
            self.thought_started = time.monotonic()
        self.thought_chars += len(text)

    def over_budget(self) -> bool:
        return (
            not self.direct
            and self.budget_chars is not None
            and not self.said
            and not self.tool_called
            and self.thought_chars > self.budget_chars
        )

    def thought_secs(self) -> float:
        return 0.0 if self.thought_started is None else round(time.monotonic() - self.thought_started, 2)

    @property
    def answered(self) -> bool:
        return self.said or self.tool_called


# One token is about four characters of English. The app sets the length in
# tokens, the stream is counted in characters.
CHARS_PER_TOKEN = 4

# Added to the instructions of the second try. The last word is the switch the
# Qwen3 family reads in its prompt; measured on 08.10.2026 with the 4B build
# named above, three of three answers came with an empty thought.
DIRECT_INSTRUCTION = (
    "Answer right away, in one to three short spoken sentences. Do not reason step by step first. /no_think"
)

# With thinking switched off, a model that thinks anyway gets this much room
# before its turn is asked again. About three seconds on a small local model.
UNWANTED_THOUGHT_TOKENS = 150

# Said when the model gave no answer at all, twice. The user asked something
# and has to hear that nothing came of it.
NO_ANSWER_SENTENCE = "Sorry, I did not get an answer together. Please ask me again."
