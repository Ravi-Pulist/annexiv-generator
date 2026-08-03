"""Input schema: "specifications on input data, as appropriate" (point 3).

A typed input model is a specification a machine can read: field names, types,
units and ranges. Parsed statically with :mod:`ast` rather than imported —
this tool runs against client repositories, and importing a stranger's module
to document it would execute their code.
"""

from __future__ import annotations

import ast

from ..model import EvidenceRecord
from ..repo import RepoContext

CANDIDATES = ("input_schema.py", "src/input_schema.py", "schemas.py",
              "src/schemas.py", "api/schemas.py")


def _pydantic_models(tree: ast.Module) -> list[tuple[str, list[str]]]:
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        bases = {getattr(b, "id", getattr(b, "attr", "")) for b in node.bases}
        if not ({"BaseModel", "BaseSettings"} & bases):
            continue
        fields = [n.target.id for n in node.body
                  if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)]
        out.append((node.name, fields))
    return out


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    rel = repo.first_existing(*CANDIDATES)
    if not rel:
        return []
    try:
        tree = ast.parse(repo.read_text(rel))
    except (OSError, SyntaxError):
        return []
    models = _pydantic_models(tree)
    if not models:
        return []
    name, fields = max(models, key=lambda m: len(m[1]))
    return [EvidenceRecord.measured(
        extractor="input_schema", source_path=rel, source_sha256=repo.sha256(rel),
        locator=f"class:{name}",
        summary=(f"typed input specification {name} with {len(fields)} declared "
                 f"field(s): {', '.join(fields[:12])}"),
        provides=("schema.input_specification",),
        commit=repo.commit,
    )]
