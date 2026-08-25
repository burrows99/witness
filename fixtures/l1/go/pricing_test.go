package main

import "testing"

// The fixture for `mode: test`: a library-style test, which is how almost all
// real Go code gets driven — there is no main package to point at.
func TestApplyTieredDiscountsForTierTwo(t *testing.T) {
	got := applyTiered(100, 2)
	if got != 90 {
		t.Fatalf("applyTiered(100, 2) = %v, want 90", got)
	}
}

func TestApplyTieredLeavesTierOneAlone(t *testing.T) {
	if got := applyTiered(100, 1); got != 100 {
		t.Fatalf("applyTiered(100, 1) = %v, want 100", got)
	}
}
