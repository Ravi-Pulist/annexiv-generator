"""Pydantic specification of one inference input.

Annex IV point 3 asks for "specifications on the input data" -- what the system
expects, in what units, within what range. This module is the executable form
of that specification: if a deployer's integration passes something outside
these bounds, construction raises rather than silently scoring a nonsense
encounter.

The bounds here are the SAME clinical plausibility intervals the training-time
cleaner uses (`config/training.yaml`, `data.cleaning.bounds`). That is checked
by the test suite -- a drift between what the cleaner accepted at training time
and what the API accepts at inference time is exactly the kind of silent
mismatch that produces out-of-distribution predictions in production.

Ranges are *acceptance* bounds, not the observed range of the training data.
The observed range is narrower; see `data/manifest.json` and the model card's
limitations section.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: Kept in lockstep with config/training.yaml -> data.cleaning.bounds.
#: (name, unit, minimum, maximum)
FEATURE_BOUNDS: dict[str, tuple[str, float, float]] = {
    "heart_rate": ("bpm", 20.0, 220.0),
    "systolic_bp": ("mmHg", 50.0, 250.0),
    "diastolic_bp": ("mmHg", 25.0, 150.0),
    "respiratory_rate": ("breaths/min", 4.0, 60.0),
    "spo2": ("%", 50.0, 100.0),
    "temperature": ("degC", 30.0, 43.0),
    "wbc": ("10^9/L", 0.1, 60.0),
    "lactate": ("mmol/L", 0.2, 20.0),
    "creatinine": ("umol/L", 10.0, 900.0),
}

#: Order the model's feature matrix must be assembled in.
FEATURE_ORDER = [
    "heart_rate",
    "systolic_bp",
    "diastolic_bp",
    "respiratory_rate",
    "spo2",
    "temperature",
    "wbc",
    "lactate",
    "creatinine",
    "age_years",
]


class EncounterFeatures(BaseModel):
    """One synthetic inpatient encounter, at the moment of scoring.

    Every field is mandatory. There is no imputation at inference time: the
    training-time median-fill is a data-preparation decision that was made
    with the training distribution in front of us, and silently reapplying it
    to a live encounter would hide a missing observation from the clinician
    rather than surface it. A deployer whose feed cannot supply all ten values
    must not call the model -- see docs/human-oversight.md.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    heart_rate: float = Field(
        ..., ge=20.0, le=220.0, description="Heart rate in bpm."
    )
    systolic_bp: float = Field(
        ..., ge=50.0, le=250.0, description="Systolic blood pressure in mmHg."
    )
    diastolic_bp: float = Field(
        ..., ge=25.0, le=150.0, description="Diastolic blood pressure in mmHg."
    )
    respiratory_rate: float = Field(
        ..., ge=4.0, le=60.0, description="Respiratory rate in breaths/min."
    )
    spo2: float = Field(
        ...,
        ge=50.0,
        le=100.0,
        description="Peripheral oxygen saturation in percent.",
    )
    temperature: float = Field(
        ..., ge=30.0, le=43.0, description="Core body temperature in degrees Celsius."
    )
    wbc: float = Field(
        ..., ge=0.1, le=60.0, description="White cell count in 10^9/L."
    )
    lactate: float = Field(
        ..., ge=0.2, le=20.0, description="Serum lactate in mmol/L."
    )
    creatinine: float = Field(
        ..., ge=10.0, le=900.0, description="Serum creatinine in umol/L."
    )
    age_years: float = Field(
        ...,
        ge=18.0,
        le=120.0,
        description=(
            "Age in years. The training cohort was 18-98; scoring an encounter "
            "above 98 is out of distribution and the model card says so."
        ),
    )

    #: Recorded alongside the features and deliberately NOT consumed by the
    #: model. Present so that a subgroup accuracy breakdown remains possible
    #: for whoever picks this up -- that it has not been done is recorded in
    #: docs/KNOWN-GAPS.md.
    sex: Literal["F", "M"] | None = None

    def to_vector(self) -> list[float]:
        """Features in the exact order `models/model.joblib` was fitted on."""
        return [float(getattr(self, name)) for name in FEATURE_ORDER]


class ScreenResult(BaseModel):
    """What the system returns. Deliberately not just a boolean."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    probability: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Model's estimated probability of deterioration.",
    )
    threshold: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Operating point in force; see eval/report.json.",
    )
    flag_for_review: bool = Field(
        ...,
        description=(
            "True when probability >= threshold. This is a prompt to look at "
            "the patient, not a diagnosis and not an escalation order."
        ),
    )
    model_sha256: str = Field(
        ...,
        min_length=64,
        max_length=64,
        description="Digest of the artifact that produced this score.",
    )
