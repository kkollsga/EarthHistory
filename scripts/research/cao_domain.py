"""Shared Cao 2024 v2.4 domain bounds for foundation emitters."""

CAO_SOURCE_YOUNGEST_MA = 0.0
CAO_SOURCE_OLDEST_MA = 1800.0
PUBLIC_FOUNDATION_MAX_BYTES = 50 * 1024 * 1024

# Dense 5 Ma through 540 Ma (existing package), then 10 Ma to the source oldest
# so the public Pages budget remains reachable while motion still uses every
# qualified source rotation knot.
DENSE_CHECKPOINT_UNTIL_MA = 540.0
COARSE_CHECKPOINT_STEP_MA = 10.0


def display_checkpoint_ages_ma(oldest_ma: float = CAO_SOURCE_OLDEST_MA) -> list[float]:
    ages = {float(age) for age in range(0, int(min(DENSE_CHECKPOINT_UNTIL_MA, oldest_ma)) + 1, 5)}
    age = DENSE_CHECKPOINT_UNTIL_MA + COARSE_CHECKPOINT_STEP_MA
    while age <= oldest_ma:
        ages.add(float(age))
        age += COARSE_CHECKPOINT_STEP_MA
    ages.add(float(oldest_ma))
    return sorted(ages)
