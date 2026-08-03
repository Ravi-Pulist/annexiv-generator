"""Mutation adequacy for the auditor.

The auditor is the component whose failure is invisible: a generator bug
produces a wrong document, which someone might notice, but an auditor bug
produces a *green tick on a wrong document*, which nobody does. The planted
defects in ``tests/test_invariant.py`` claim the auditor catches tampering.
This harness checks that claim the only way it can be checked — by breaking
the auditor on purpose and demanding the tests notice.

A mutation score without a denominator is marketing, so the denominator is
printed and the per-mutant results are written to ``results.json`` for the
measurement annex.

Usage:  python tests/mutation/mutate_audit.py
Exit 0 only when every mutant dies.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parents[2]
TARGET = REPO / "src" / "annexiv" / "audit.py"
TESTS = ["tests/test_invariant.py"]

OPERATORS = [
    # Weaken the central invariant check in every direction it can be weakened.
    ("silent_assertion_blind", re.compile(r"if not ev_ids and not gap_id:"),
     "if False:"),
    ("both_refs_blind", re.compile(r"if ev_ids and gap_id:"), "if False:"),
    ("severity_downgrade", re.compile(r'"fail"'), '"warn"'),
    ("missing_file_blind", re.compile(r"if not target\.is_file\(\):"),
     "if False:"),
    ("hash_check_blind", re.compile(r"if actual\.lower\(\) != str\(rec\.get\('source_sha256', ''\)\)\.lower\(\):"),
     "if False:"),
    ("hash_check_inverted", re.compile(r"actual\.lower\(\) !="), "actual.lower() =="),
    ("dangling_citation_blind", re.compile(r"if rec is None:"), "if False:"),
    ("dangling_gap_blind", re.compile(r"if gap_id not in gaps:"), "if False:"),
    ("empty_section_blind", re.compile(r'if not section\.get\("claims"\):'),
     "if False:"),
    ("count_check_blind", re.compile(r"if key in stated and stated\[key\] != counted:"),
     "if False:"),
    ("ok_always_true", re.compile(r"return not self\.failed"), "return True"),
    ("failed_always_empty",
     re.compile(r'return \[f for f in self\.findings if f\.severity == "fail"\]'),
     "return []"),
    ("skip_all_claims", re.compile(r'for claim in section\.get\("claims", \[\]\):'),
     'for claim in []:'),
]


def _comment_and_docstring_spans(src: str) -> list[tuple[int, int]]:
    """Character ranges that are comments or docstrings.

    Mutating a comment changes no behaviour, so such a mutant can never be
    killed. Counting it as a survivor would understate the suite's adequacy
    and counting it as killed would be a lie; the honest move is not to
    generate it. This is the ``stripCommentsAndStrings`` discipline, applied
    with the tokenizer rather than a regex.
    """
    import io
    import tokenize

    spans: list[tuple[int, int]] = []
    lines = src.splitlines(keepends=True)
    starts = [0]
    for ln in lines:
        starts.append(starts[-1] + len(ln))

    def offset(row: int, col: int) -> int:
        return starts[row - 1] + col

    try:
        toks = list(tokenize.generate_tokens(io.StringIO(src).readline))
    except tokenize.TokenError:
        return spans
    prev_type = tokenize.INDENT
    for tok in toks:
        if tok.type == tokenize.COMMENT:
            spans.append((offset(*tok.start), offset(*tok.end)))
        elif tok.type == tokenize.STRING and prev_type in (
                tokenize.INDENT, tokenize.DEDENT, tokenize.NEWLINE,
                tokenize.NL, tokenize.ENCODING):
            # a bare string statement — a docstring
            spans.append((offset(*tok.start), offset(*tok.end)))
        if tok.type not in (tokenize.NL, tokenize.COMMENT):
            prev_type = tok.type
    return spans


def mutants(src: str):
    dead_zones = _comment_and_docstring_spans(src)

    def inert(pos: int) -> bool:
        return any(a <= pos < b for a, b in dead_zones)

    for name, rx, repl in OPERATORS:
        n = 0
        for m in rx.finditer(src):
            if inert(m.start()):
                continue          # a comment/docstring mutation is not a mutation
            yield (f"{name}#{n}", src[:m.start()] + repl + src[m.end():],
                   f"line {src[:m.start()].count(chr(10)) + 1}: "
                   f"{m.group(0)[:60]!r} -> {repl!r}")
            n += 1


def run_tests() -> bool:
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider",
         *TESTS],
        cwd=REPO, capture_output=True, text=True, timeout=600)
    return r.returncode == 0


def main() -> int:
    original = TARGET.read_text(encoding="utf-8")

    if not run_tests():
        print("REFUSED: the oracle fails on unmutated code — fix the tests first.")
        return 2

    results = {"target": "src/annexiv/audit.py", "oracle": TESTS,
               "mutants": [], "killed": 0, "survived": 0}
    try:
        for mid, mutated, describe in mutants(original):
            TARGET.write_text(mutated, encoding="utf-8")
            killed = not run_tests()
            results["mutants"].append({"id": mid, "site": describe,
                                       "killed": killed})
            results["killed" if killed else "survived"] += 1
            print(f"{'KILLED  ' if killed else 'SURVIVED'} {mid:28s} {describe}")
    finally:
        TARGET.write_text(original, encoding="utf-8")

    total = results["killed"] + results["survived"]
    results["score"] = f"{results['killed']}/{total}"
    (Path(__file__).parent / "results.json").write_text(
        json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"\nmutation score: {results['score']} "
          f"({'ADEQUATE' if not results['survived'] else 'INADEQUATE'})")
    return 0 if results["survived"] == 0 and total else 1


if __name__ == "__main__":
    sys.exit(main())
