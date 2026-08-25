// A tiny fixture: one function with a discount branch and a guard.
package main

import "fmt"

func applyTiered(total float64, tier int) float64 {
	base := total
	if tier >= 2 {
		bonus := float64(tier) * 0.05
		return base * (1 - bonus)
	}
	if total < 0 {
		panic("total must not be negative")
	}
	return base
}

func main() {
	fmt.Println("result", applyTiered(100, 2))
}
