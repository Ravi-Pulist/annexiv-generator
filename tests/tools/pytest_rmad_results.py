"""Run pytest and emit RMAD task-oracle JSON: [{"subject", "value"}, ...].

Usage: python tests/tools/pytest_rmad_results.py [pytest args]
Writes rmad-results.json in the cwd; exits with pytest's status.
"""

import json
import sys

import pytest


class _Collect:
    def __init__(self):
        self.results = []

    def pytest_runtest_logreport(self, report):
        if report.when == "call":
            self.results.append({
                "subject": report.nodeid,
                "value": "pass" if report.passed else "fail",
            })
        elif report.when == "setup" and report.skipped:
            self.results.append({"subject": report.nodeid, "value": "skip"})


def main() -> int:
    collector = _Collect()
    code = pytest.main(sys.argv[1:] or ["tests"], plugins=[collector])
    with open("rmad-results.json", "w", encoding="utf-8") as fh:
        json.dump(collector.results, fh, indent=1)
    print(f"rmad-results.json: {len(collector.results)} results")
    return int(code)


if __name__ == "__main__":
    sys.exit(main())
