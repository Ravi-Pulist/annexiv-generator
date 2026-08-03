"""annexiv — EU AI Act Annex IV technical documentation, generated from a repository.

Every claim cites machine-checkable evidence or is flagged as a gap. This tool
provides documentation support and engineering evidence. It is not legal
advice, it is not a conformity assessment, and it does not by itself make any
system compliant.
"""

__version__ = "0.1.0"

#: Version of the pack/completion-state JSON schema this build emits.
PACK_SCHEMA_VERSION = "1.0"

#: The boundary statement. Rendered on the pack front page and printed by the
#: CLI. Defined once, here, so it cannot drift between surfaces.
BOUNDARY_STATEMENT = (
    "This pack is documentation support and engineering evidence. It is not "
    "legal advice, not a conformity assessment, and does not by itself make "
    "any system compliant. Classification of the system and submission to any "
    "authority remain with the provider's regulatory and legal owners. No tool "
    "can certify conformity."
)
