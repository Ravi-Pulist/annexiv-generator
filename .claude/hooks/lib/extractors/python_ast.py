#!/usr/bin/env python3
"""python_ast.py — real-AST symbol extraction for the RMAD code graph.

Emits one JSON document per file on stdout. Invoked by extractors/python.js.

WHY AN AST AND NOT REGEX: the graph is meant to be something a staff architect can
trust enough to act on. A regex extractor mis-reads decorators, nested classes,
multi-line signatures, and string literals containing `def `, and it does so silently.
A wrong graph is worse than no graph: it produces confident advice about code that
does not exist. Python ships an exact parser; use it. JS/TS falls back to heuristics
and SAYS SO in the node's `fidelity` field, so a consumer can tell what it's reading.
"""
import ast
import json
import sys
import hashlib


def _seg(node, src_lines):
    try:
        return ast.get_source_segment("\n".join(src_lines), node)
    except Exception:
        return None


def _ann(node):
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def _decorators(node):
    out = []
    for d in getattr(node, "decorator_list", []) or []:
        try:
            out.append(ast.unparse(d))
        except Exception:
            pass
    return out


def _route_from_decorators(decs):
    """FastAPI/Flask route detection: @app.get('/x'), @router.post('/y')."""
    for d in decs:
        for verb in ("get", "post", "put", "patch", "delete", "head", "options", "route"):
            needle = "." + verb + "("
            if needle in d.lower():
                start = d.find("(")
                inner = d[start + 1:]
                path = None
                for q in ("'", '"'):
                    if q in inner:
                        a = inner.find(q)
                        b = inner.find(q, a + 1)
                        if b > a:
                            path = inner[a + 1:b]
                            break
                return {"method": verb.upper(), "path": path, "decorator": d}
    return None


def _args(node):
    a = node.args
    out = []

    def add(arg, kind, default=None):
        out.append({
            "name": arg.arg,
            "annotation": _ann(arg.annotation),
            "kind": kind,
            "default": default,
        })

    posonly = getattr(a, "posonlyargs", []) or []
    for arg in posonly:
        add(arg, "positional-only")
    # defaults align to the TAIL of posonly+args
    positional = posonly + list(a.args)
    ndef = len(a.defaults)
    for i, arg in enumerate(a.args):
        idx = len(posonly) + i
        default = None
        if ndef and idx >= len(positional) - ndef:
            d = a.defaults[idx - (len(positional) - ndef)]
            default = _ann(d)
        add(arg, "positional", default)
    if a.vararg:
        add(a.vararg, "vararg")
    for i, arg in enumerate(a.kwonlyargs):
        d = a.kw_defaults[i] if i < len(a.kw_defaults) else None
        add(arg, "keyword-only", _ann(d) if d is not None else None)
    if a.kwarg:
        add(a.kwarg, "kwarg")
    return out


def _calls(node):
    """Callee names invoked inside this node.

    Emits the FULL dotted path plus the receiver, because the last segment alone is
    useless for resolution: `os.environ.get`, `payload.get` and `client.get` all end in
    `get`, and collapsing them onto one symbol invents hundreds of call edges that do
    not exist. The receiver is what lets code-graph.js disambiguate.
    """
    found = []
    # A decorator is syntactically a Call, but `@router.get("/x")` is a ROUTE, not this
    # function calling `get`. Counting decorators as calls inflated `router.get` into the
    # busiest symbol in the repo. Decorators are captured separately (see _decorators).
    skip = set()
    for d in getattr(node, "decorator_list", []) or []:
        for sub in ast.walk(d):
            skip.add(id(sub))
    for n in ast.walk(node):
        if isinstance(n, ast.Call) and id(n) not in skip:
            f = n.func
            full = None
            receiver = None
            if isinstance(f, ast.Name):
                full = f.id
            elif isinstance(f, ast.Attribute):
                try:
                    full = ast.unparse(f)
                except Exception:
                    full = f.attr
                try:
                    receiver = ast.unparse(f.value)
                except Exception:
                    receiver = None
            if full:
                found.append({
                    "callee": full,
                    "name": full.split(".")[-1],
                    "receiver": receiver,
                    "line": getattr(n, "lineno", None),
                })
    return found


def _bindings(tree):
    """Variable -> class bindings, so `data_svc.get(...)` can resolve to InternalClient.get.

    Without this, a receiver-aware resolver refuses to link singleton-client calls at all
    and the client's methods look dead. Covers the two shapes that carry most real code:
      module level :  data_svc = InternalClient("data")
      in __init__  :  self.store = TenantStore(...)
    This is type inference only in the loosest sense — it is a literal constructor
    binding, not flow analysis. It resolves the common case and stays silent on the rest.
    """
    out = []

    def bind_from(node, prefix=None):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            return
        value = node.value
        if not isinstance(value, ast.Call):
            return
        cls = None
        if isinstance(value.func, ast.Name):
            cls = value.func.id
        elif isinstance(value.func, ast.Attribute):
            cls = value.func.attr
        if not cls or not cls[:1].isupper():
            return  # constructors are Capitalised; a lowercase callee is a factory fn
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        for t in targets:
            if isinstance(t, ast.Name):
                out.append({"var": t.id, "type": cls, "scope": prefix or "module", "line": node.lineno})
            elif isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "self":
                out.append({"var": "self." + t.attr, "type": cls, "scope": prefix or "module", "line": node.lineno})

    for node in tree.body:
        bind_from(node)
        if isinstance(node, ast.ClassDef):
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for stmt in ast.walk(sub):
                        bind_from(stmt, node.name)
    return out


def _complexity(node):
    """Rough cyclomatic complexity: decision points + 1."""
    c = 1
    for n in ast.walk(node):
        if isinstance(n, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler,
                          ast.With, ast.AsyncWith, ast.Assert, ast.comprehension)):
            c += 1
        elif isinstance(n, ast.BoolOp):
            c += len(n.values) - 1
        elif isinstance(n, ast.IfExp):
            c += 1
    return c


def _func(node, src_lines, parent=None):
    decs = _decorators(node)
    doc = ast.get_docstring(node)
    return {
        "kind": "method" if parent else "function",
        "name": node.name,
        "qualname": (parent + "." + node.name) if parent else node.name,
        "line": node.lineno,
        "end_line": getattr(node, "end_lineno", node.lineno),
        "is_async": isinstance(node, ast.AsyncFunctionDef),
        "args": _args(node),
        "returns": _ann(node.returns),
        "decorators": decs,
        "route": _route_from_decorators(decs),
        "doc": doc,
        "complexity": _complexity(node),
        "calls": _calls(node),
        "loc": (getattr(node, "end_lineno", node.lineno) or node.lineno) - node.lineno + 1,
    }


def extract(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        src = fh.read()
    digest = hashlib.sha1(src.encode("utf-8", "replace")).hexdigest()
    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        return {
            "path": path, "language": "python", "fidelity": "ast",
            "error": "SyntaxError: {} (line {})".format(e.msg, e.lineno),
            "hash": digest, "symbols": [], "imports": [], "loc": src.count("\n") + 1,
        }

    src_lines = src.split("\n")
    imports, symbols = [], []

    for node in tree.body:
        if isinstance(node, ast.Import):
            for a in node.names:
                imports.append({"module": a.name, "name": None, "alias": a.asname,
                                "line": node.lineno, "relative": 0})
        elif isinstance(node, ast.ImportFrom):
            for a in node.names:
                imports.append({"module": node.module, "name": a.name, "alias": a.asname,
                                "line": node.lineno, "relative": node.level or 0})

    def walk(body, parent=None):
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                symbols.append(_func(node, src_lines, parent))
            elif isinstance(node, ast.ClassDef):
                bases = []
                for b in node.bases:
                    try:
                        bases.append(ast.unparse(b))
                    except Exception:
                        pass
                symbols.append({
                    "kind": "class",
                    "name": node.name,
                    "qualname": (parent + "." + node.name) if parent else node.name,
                    "line": node.lineno,
                    "end_line": getattr(node, "end_lineno", node.lineno),
                    "bases": bases,
                    "decorators": _decorators(node),
                    "doc": ast.get_docstring(node),
                    "loc": (getattr(node, "end_lineno", node.lineno) or node.lineno) - node.lineno + 1,
                })
                walk(node.body, (parent + "." + node.name) if parent else node.name)
            elif isinstance(node, ast.Assign) and parent is None:
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id.isupper():
                        symbols.append({"kind": "constant", "name": t.id, "qualname": t.id,
                                        "line": node.lineno, "end_line": node.lineno, "loc": 1})

    walk(tree.body)

    # Module-level calls: `data_svc = InternalClient("data")`, `app.add_middleware(X)`,
    # `register(Handler)`. These live OUTSIDE any function body, so walking only function
    # bodies makes every module-scope instantiation invisible — and then every class
    # constructed at import time looks dead. InternalClient (36 real call sites) was
    # reported as an orphan for exactly this reason.
    module_calls = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue  # already covered by _func / walk()
        for c in _calls(node):
            module_calls.append(c)

    return {
        "path": path,
        "language": "python",
        "fidelity": "ast",
        "hash": digest,
        "doc": ast.get_docstring(tree),
        "loc": src.count("\n") + 1,
        "imports": imports,
        "symbols": symbols,
        "bindings": _bindings(tree),
        "module_calls": module_calls,
    }


if __name__ == "__main__":
    out = []
    for p in sys.argv[1:]:
        try:
            out.append(extract(p))
        except Exception as e:  # never take the whole index down for one file
            out.append({"path": p, "language": "python", "error": str(e),
                        "symbols": [], "imports": [], "fidelity": "ast"})
    json.dump(out, sys.stdout)
