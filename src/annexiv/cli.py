"""CLI: ``annexiv generate`` · ``annexiv audit`` · ``annexiv gaps``.

Exit codes are the product, as elsewhere in this portfolio:

``generate``  0 the pack was written · 2 the run could not proceed
``audit``     0 every check passed · 1 the pack failed a check · 2 could not run
``gaps``      0 no gaps · 1 gaps exist (so CI can gate on readiness)

``audit`` exiting 1 is a working tool reporting a true finding, not an error.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import BOUNDARY_STATEMENT, PACK_SCHEMA_VERSION, __version__
from .audit import audit_pack
from .model import Pack, canonical_json
from .predicate import completion_state, evaluate
from .render import render_markdown
from .repo import RepoContext
from .spec import load_spec


def _build_pack(repo: RepoContext, spec, route: str | None) -> Pack:
    sections, evidence, gaps, errors = evaluate(repo, spec)
    completion = completion_state(spec, sections, evidence, gaps,
                                  repo.commit, __version__)
    if errors:
        for e in errors:
            print(f"  warning: {e}", file=sys.stderr)
    return Pack(
        spec_version=spec.spec_version,
        tool_version=__version__,
        repo_commit=repo.commit,
        repo_name=repo.name,
        classification_route=route,
        sections=tuple(sections),
        evidence=tuple(evidence),
        gaps=tuple(gaps),
        completion=completion,
    )


def cmd_generate(args) -> int:
    spec = load_spec(args.spec)
    repo = RepoContext(args.repo)
    if not repo.root.is_dir():
        print(f"error: {repo.root} is not a directory", file=sys.stderr)
        return 2
    if args.route and args.route not in spec.route_names:
        print(f"error: unknown route {args.route!r}; expected one of "
              f"{', '.join(spec.route_names)}", file=sys.stderr)
        return 2

    pack = _build_pack(repo, spec, args.route)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    pack_json = out / "pack.json"
    pack_json.write_text(canonical_json(pack), encoding="utf-8", newline="\n")
    (out / "annex-iv.md").write_text(render_markdown(pack, spec),
                                     encoding="utf-8", newline="\n")
    (out / "completion-state.json").write_text(
        canonical_json(pack.completion), encoding="utf-8", newline="\n")
    (out / "gap-register.json").write_text(
        canonical_json([g.model_dump(mode="json") for g in pack.gaps]),
        encoding="utf-8", newline="\n")

    c = pack.completion
    if repo.is_dirty:
        print("  warning: the repository has uncommitted changes; the pack "
              "pins a commit that does not describe the working tree",
              file=sys.stderr)
    print(f"annexiv {__version__} · {repo.name} @ "
          f"{(repo.commit or 'no-commit')[:12]}")
    print(f"sections addressed: {c.sections_addressed}/{c.sections_total}")
    print(f"claims: {c.claims_total} "
          f"({c.claims_evidence_backed} evidence-backed, {c.claims_gapped} gaps)")
    print(f"evidence-backed ratio: {100 * c.evidence_backed_ratio:.1f}% · "
          f"MEASURED share: {100 * c.measured_share:.1f}%")
    print(f"gap register: {c.gaps_total} ({c.gaps_permanent} permanent)")
    print(f"written: {pack_json}")
    print(BOUNDARY_STATEMENT)
    return 0


def cmd_audit(args) -> int:
    pack_path = Path(args.pack)
    if not pack_path.is_file():
        print(f"error: no pack at {pack_path}", file=sys.stderr)
        return 2
    res = audit_pack(pack_path, Path(args.repo))
    print(f"annexiv audit · {res.summary()}")
    for f in res.findings:
        marker = "FAIL" if f.severity == "fail" else "warn"
        print(f"  [{marker}] {f.check}: {f.detail}")
    if res.ok:
        print("AUDIT PASSED — every claim resolves to evidence or a gap, "
              "every citation resolves to a file whose hash still matches")
        return 0
    print(f"AUDIT FAILED — {len(res.failed)} check(s) failed")
    return 1


def cmd_gaps(args) -> int:
    spec = load_spec(args.spec)
    repo = RepoContext(args.repo)
    pack = _build_pack(repo, spec, args.route)
    if not pack.gaps:
        print("no gaps — every requirement in the mapping spec is evidenced")
        return 0
    print(f"{len(pack.gaps)} gap(s) in {repo.name}:")
    print()
    for g in pack.gaps:
        where = (f"{g.section}({g.subpoint})"
                 if g.subpoint and g.subpoint != "whole" else str(g.section))
        tag = " [PERMANENT]" if g.permanent else ""
        print(f"  Annex IV {where}{tag} — {g.kind.value}")
        print(f"    {g.reason}")
        print(f"    to close: {g.remediation}")
        print()
    return 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="annexiv",
        description=("EU AI Act Annex IV technical documentation, generated "
                     "from a repository. " + BOUNDARY_STATEMENT))
    ap.add_argument("--version", action="version",
                    version=f"annexiv {__version__} (pack schema "
                            f"{PACK_SCHEMA_VERSION})")
    sub = ap.add_subparsers(dest="command", required=True)

    g = sub.add_parser("generate", help="generate the Annex IV pack")
    g.add_argument("repo", type=Path)
    g.add_argument("--out", type=Path, default=Path("out"))
    g.add_argument("--spec", type=Path, default=None)
    g.add_argument("--route", default=None,
                   help="classification route DECLARED BY THE PROVIDER "
                        "(annex_i | annex_iii); this tool never determines it")
    g.set_defaults(func=cmd_generate)

    a = sub.add_parser("audit", help="independently re-walk a generated pack")
    a.add_argument("pack", type=Path, help="path to pack.json")
    a.add_argument("--repo", type=Path, required=True)
    a.set_defaults(func=cmd_audit)

    gp = sub.add_parser("gaps", help="the gap register alone (readiness scan)")
    gp.add_argument("repo", type=Path)
    gp.add_argument("--spec", type=Path, default=None)
    gp.add_argument("--route", default=None)
    gp.set_defaults(func=cmd_gaps)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
