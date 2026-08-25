import { describe, expect, it } from 'vitest'
import { DEFAULT_BRAND, brandFrom, resolveBrand, schemaKind } from '../../src/brand.js'

/**
 * The product's name, in one place.
 *
 * It was spread across 179 literals: the state directory, the environment
 * variables, the bypass label, the schema ids, the help text. Renaming meant
 * a careful sweep with no way to tell which occurrences were cosmetic and
 * which were wire format that other people's committed files depend on.
 */

describe('brandFrom — one name, everything else derived', () => {
  it('derives every surface from a single word', () => {
    const brand = brandFrom('acme')
    expect(brand.cli).toBe('acme')
    expect(brand.dir).toBe('.acme')
    expect(brand.envPrefix).toBe('ACME')
    expect(brand.bypassLabel).toBe('acme:bypass')
    expect(brand.schemaNs).toBe('acme')
  })

  it('turns a hyphenated name into a legal environment prefix', () => {
    // `SWE_VERIFY_JS_DEBUG`, not `SWE-VERIFY_JS_DEBUG`, which no shell exports.
    expect(brandFrom('swe-verify').envPrefix).toBe('SWE_VERIFY')
    expect(brandFrom('my.tool v2').envPrefix).toBe('MY_TOOL_V2')
  })

  it('refuses a name that cannot be a directory or a label', () => {
    for (const bad of ['', '   ', '../escape', 'has/slash']) {
      expect(() => brandFrom(bad), bad).toThrow()
    }
  })

  it('leaves the default alone', () => {
    expect(DEFAULT_BRAND.dir).toBe('.swe-verify')
    expect(DEFAULT_BRAND.envPrefix).toBe('SWE_VERIFY')
  })
})

describe('resolveBrand — renaming without editing source', () => {
  it('uses the default when nothing says otherwise', () => {
    expect(resolveBrand({}).cli).toBe('swe-verify')
  })

  it('takes the name from the environment', () => {
    expect(resolveBrand({ SWE_VERIFY_BRAND: 'acme' }).dir).toBe('.acme')
  })

  it('accepts the renamed variable too, so a rebrand is not one-way', () => {
    // After renaming to `acme`, an operator naturally reaches for ACME_BRAND.
    // Only honouring the old name would make the rebrand permanently leaky.
    expect(resolveBrand({ ACME_BRAND: 'acme' }).cli).toBe('acme')
  })

  it('ignores a name it could not use, rather than failing every command', () => {
    expect(resolveBrand({ SWE_VERIFY_BRAND: '../escape' }).cli).toBe('swe-verify')
  })
})

describe('schemaKind — reading files written under another name', () => {
  /**
   * The part that must not break. `swe-verify/plan@1` is written into every
   * committed plan and every sealed story. If a rename made those unreadable,
   * renaming would silently orphan a team's entire history — so the brand is
   * ignored on read and only the kind and major version are checked.
   */
  it('reads a document written under the default name', () => {
    expect(schemaKind('swe-verify/plan@1')).toEqual({ kind: 'plan', major: 1 })
  })

  it('reads one written under any other name', () => {
    expect(schemaKind('acme/plan@1')).toEqual({ kind: 'plan', major: 1 })
    expect(schemaKind('some.long-name/story@1')).toEqual({ kind: 'story', major: 1 })
  })

  it('still refuses a kind it does not understand', () => {
    expect(schemaKind('acme/invoice@1')).toBeNull()
  })

  it('still refuses a major version it does not understand', () => {
    expect(schemaKind('acme/plan@2')).toBeNull()
  })

  it('refuses something that is not a schema id at all', () => {
    for (const bad of ['plan', 'acme/plan', '@1', '']) expect(schemaKind(bad), bad).toBeNull()
  })
})
