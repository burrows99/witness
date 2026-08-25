"""A tiny fixture: one function with a discount branch and a guard."""


def apply_tiered(total, tier):
    base = total
    if tier >= 2:
        bonus = tier * 0.05
        return base * (1 - bonus)
    if total < 0:
        raise ValueError("total must not be negative")
    return base


def main():
    print("result", apply_tiered(100, 2))


if __name__ == "__main__":
    main()
