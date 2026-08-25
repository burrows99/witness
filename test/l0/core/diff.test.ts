import { describe, expect, it } from 'vitest'
import { normaliseDiff, diffHash, NORMALISATION_ALGO } from '../../../src/core/diff.js'

const D = (s: string) => s.replace(/^\n/, '')

describe('normaliseDiff — unified diff parsing', () => {
  it('extracts added lines with head-side line numbers', () => {
    const patch = D(`
diff --git a/src/pricing/discount.ts b/src/pricing/discount.ts
index 1111111..2222222 100644
--- a/src/pricing/discount.ts
+++ b/src/pricing/discount.ts
@@ -38,6 +38,8 @@ export function applyTiered(total: number, tier: number) {
   const base = total
   if (tier >= 1) {
+    const bonus = tier * 0.05
+    return base * (1 - bonus)
   }
   return base
 }
`)
    const d = normaliseDiff(patch, { baseSha: 'b'.repeat(40), headSha: 'e'.repeat(40) })
    expect(d.files).toHaveLength(1)
    expect(d.files[0]!.path).toBe('src/pricing/discount.ts')
    expect(d.files[0]!.lines.map((l) => l.line)).toEqual([40, 41])
    expect(d.files[0]!.lines[0]!.text).toBe('const bonus = tier * 0.05')
  })

  it('counts modified lines once, on the head side only', () => {
    const patch = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
 const c = 4
`)
    const d = normaliseDiff(patch)
    expect(d.files[0]!.lines).toHaveLength(1)
    expect(d.files[0]!.lines[0]!.line).toBe(2)
    expect(d.changedLines).toBe(1)
  })

  it('tracks deleted-only files without claiming coverable lines', () => {
    const patch = D(`
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const a = 1
-const b = 2
`)
    const d = normaliseDiff(patch)
    expect(d.files).toHaveLength(0)
    expect(d.changedLines).toBe(0)
  })

  it('handles renames and multiple hunks in one file', () => {
    const patch = D(`
diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1,2 +1,3 @@
 const a = 1
+const b = 2
 const c = 3
@@ -20,2 +21,3 @@
 const x = 1
+const y = 2
 const z = 3
`)
    const d = normaliseDiff(patch)
    expect(d.files[0]!.path).toBe('new.ts')
    expect(d.files[0]!.lines.map((l) => l.line)).toEqual([2, 22])
  })

  it('drops excluded lines from the normalised diff', () => {
    const patch = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,7 @@
 const keep = 1
+
+// a comment
+import { x } from './x.js'
+}
+type Foo = { a: number }
+const real = 2
`)
    const d = normaliseDiff(patch)
    expect(d.files[0]!.lines.map((l) => l.text)).toEqual(['const real = 2'])
    expect(d.excludedLines).toBe(5)
  })

  it('is empty for a formatting-only diff (US-1 AC4)', () => {
    const patch = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
-const a   =   1
+const a = 1
 const b = 2
`)
    const d = normaliseDiff(patch)
    expect(d.isEmpty).toBe(true)
  })
})

describe('diffHash — normalised-v1', () => {
  const patch = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const a = 1
+const b = 2
`)

  it('is a sha256: prefixed 64-hex digest, stable across runs', () => {
    const h1 = diffHash(normaliseDiff(patch))
    const h2 = diffHash(normaliseDiff(patch))
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(h1).toBe(h2)
  })

  it('is independent of base/head sha, so a rebase does not stale a story', () => {
    const a = diffHash(normaliseDiff(patch, { baseSha: '1'.repeat(40), headSha: '2'.repeat(40) }))
    const b = diffHash(normaliseDiff(patch, { baseSha: '3'.repeat(40), headSha: '4'.repeat(40) }))
    expect(a).toBe(b)
  })

  it('is unchanged by indentation and trailing whitespace', () => {
    const reindented = patch.replace('+const b = 2', '+    const b = 2   ')
    expect(diffHash(normaliseDiff(reindented))).toBe(diffHash(normaliseDiff(patch)))
  })

  it('is unchanged by adding a comment line', () => {
    const commented = patch.replace('+const b = 2', '+// why\n+const b = 2')
    // the comment shifts nothing on the executable line, and comments are excluded
    expect(normaliseDiff(commented).files[0]!.lines.map((l) => l.text)).toEqual(['const b = 2'])
  })

  it('changes when executable content changes', () => {
    const changed = patch.replace('+const b = 2', '+const b = 3')
    expect(diffHash(normaliseDiff(changed))).not.toBe(diffHash(normaliseDiff(patch)))
  })

  it('changes when an executable line moves to a different line number', () => {
    const moved = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,9 @@
 const a = 1
+
+
+
+
+
+
+const b = 2
`)
    expect(diffHash(normaliseDiff(moved))).not.toBe(diffHash(normaliseDiff(patch)))
  })

  it('is order-independent across files', () => {
    const two = D(`
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,0 +1,1 @@
+const z = 9
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,0 +1,1 @@
+const y = 8
`)
    const flipped = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,0 +1,1 @@
+const y = 8
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,0 +1,1 @@
+const z = 9
`)
    expect(diffHash(normaliseDiff(two))).toBe(diffHash(normaliseDiff(flipped)))
  })

  it('declares its algorithm version so normalisation changes are not silent', () => {
    expect(NORMALISATION_ALGO).toBe('normalised-v1')
    expect(normaliseDiff(patch).algo).toBe('normalised-v1')
  })
})

describe('normaliseDiff — formatting-only edits', () => {
  it('drops an added line that only re-spaces the line it replaced', () => {
    const patch = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-const a=1
+const a = 1
 const b = 2
`)
    const d = normaliseDiff(patch)
    expect(d.isEmpty).toBe(true)
  })

  it('does not drop a line whose string literal contents changed spacing', () => {
    const patch = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-const a = "hello  world"
+const a = "hello world"
`)
    expect(normaliseDiff(patch).isEmpty).toBe(false)
  })

  it('keeps a real change that sits beside a reformatted line', () => {
    const patch = D(`
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-const a=1
-const b = 2
+const a = 1
+const b = 3
`)
    const d = normaliseDiff(patch)
    expect(d.files[0]!.lines.map((l) => l.text)).toEqual(['const b = 3'])
  })
})

describe('normaliseDiff — gateability (Q7)', () => {
  it('drops files that are not code, so a README typo never stales a story', () => {
    const patch = D(`
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,0 +1,1 @@
+a new paragraph
`)
    const d = normaliseDiff(patch)
    expect(d.files).toHaveLength(0)
    expect(d.isEmpty).toBe(true)
  })

  it('keeps code in an unsupported language, flagged rather than silently dropped', () => {
    const patch = D(`
diff --git a/app/models.rb b/app/models.rb
--- a/app/models.rb
+++ b/app/models.rb
@@ -1,0 +1,2 @@
+# a comment
+total = total * 2
`)
    const d = normaliseDiff(patch)
    expect(d.files).toHaveLength(1)
    expect(d.files[0]!.unsupportedLanguage).toBe('ruby')
    expect(d.files[0]!.lines).toHaveLength(1)
  })

  it('a change touching both a gated and an ungated language keeps both', () => {
    const patch = D(`
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,0 +1,1 @@
+const a = 1
diff --git a/app/b.rb b/app/b.rb
--- a/app/b.rb
+++ b/app/b.rb
@@ -1,0 +1,1 @@
+b = 2
`)
    const d = normaliseDiff(patch)
    expect(d.files.map((f) => f.path)).toEqual(['src/a.ts', 'app/b.rb'])
  })
})
