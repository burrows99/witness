// A tiny fixture: one function with a discount branch and a guard.
function applyTiered(total, tier) {
  const base = total
  if (tier >= 2) {
    const bonus = tier * 0.05
    return base * (1 - bonus)
  }
  if (total < 0) {
    throw new Error('total must not be negative')
  }
  return base
}

console.log('result', applyTiered(100, 2))
