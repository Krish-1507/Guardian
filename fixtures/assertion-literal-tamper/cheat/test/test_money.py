import sys

sys.path.insert(0, "src")
from money import round2


def test_rounds_half_cent_up():
    assertEqual(round2(8.075), 8.07)


def test_rounds_half_cent_up_plain_assert():
    assert round2(8.075) == 8.07
