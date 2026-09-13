# Reconstruction refresh loading and guide validation

**Validated:** 2026-09-13
**Detailed measurements:**
[`refresh-loading-validation.json`](refresh-loading-validation.json)

## Result

Repeated page loads were slow because the application requested every Cao
package payload with `cache: no-store`. A warm refresh therefore transferred
13.76–13.88 MB again even though every payload URL already carried its expected
SHA-256 and the loader verified both byte length and digest before publication.
Network completion accounted for all but 20–67 ms of the measured wait.

The manifest remains an unversioned `no-store` request so a package promotion is
seen immediately. A package payload may use the browser cache only when its URL
has one lowercase 64-character `h` query equal to the descriptor SHA-256. A sole
stale or malformed sole authored `h` value is replaced with the current
descriptor hash. After canonicalization, unversioned, fragmented, or otherwise
queried request URLs retain `no-store`. Length, digest, abort, and all-or-nothing
surface publication checks are unchanged.

The same change set completes the optional schematic guides with the two
missing cardinal meridians (90 new meridian vertices) and 56 short one-degree
crossing ticks (112 vertices) across the seven existing latitude guides. These
remain a cartographic reference layer rather than period evidence.

## End-to-visible measurements

The control is the exact pre-change branch build based on v0.1.5 plus the
already accepted post-0.1.5 rendering and geography corrections. Its index SHA
is `7d8a6194a3e5544f2a6c6c78aabc4d1691e6fb3545a9e920cd9e1701679c3d1b`.
The candidate index SHA is
`10e6d3cf73e18487fd41bdb4dd253287687e5977fbae0877712d8a94510567bc`;
both use outer data manifest SHA
`194ca507542d46b50c66c7b5b9acc9aa34bf933f53bcb54804d87c8aad76a982`.

Chrome 152.0.7977.83 ran headed at 1440×900 on an Apple M4 Mac with a
20 Mbit/s download, 10 Mbit/s upload, and 50 ms latency discriminator. Each
automatic-renderer and forced-WebGL2 case used three fresh-context loads and
three same-context refreshes at 0 and 411 Ma. The endpoint was the first
visibly populated Cao frame: the ready signal is published only after
`renderer.render()` returns, and a canvas screenshot bounded the witness.

| Renderer / age | Cold control | Cold candidate | Warm control | Warm candidate | Warm gain |
| --- | ---: | ---: | ---: | ---: | ---: |
| Automatic / 0 Ma | 6770.6 ms | 6776.8 ms | 6555.4 ms | 442.2 ms | 6113.2 ms (93.25%) |
| Automatic / 411 Ma | 6766.9 ms | 6772.6 ms | 6589.8 ms | 413.7 ms | 6176.1 ms (93.72%) |
| WebGL2 / 0 Ma | 6754.2 ms | 6758.1 ms | 6568.1 ms | 440.4 ms | 6127.7 ms (93.30%) |
| WebGL2 / 411 Ma | 6759.4 ms | 6768.9 ms | 6603.0 ms | 435.9 ms | 6167.1 ms (93.40%) |

Warm transferred reconstruction bytes fell to 13,319 bytes from
13,763,004–13,875,690 bytes. Cold results changed by only 3.9–9.5 ms, so this
does not claim faster first visits. A first visit, an evicted cache, or a user
disabled cache still transfers and verifies the full package.

Three alternating fixed-scene pairs at 411 Ma then compared the guide-enabled
control and candidate over two seconds each. Median cadence was 59.967 fps for
the control and 59.961 fps for the candidate, a 99.990% ratio; candidate median
frame p50 was 16.7 ms. All rows were visible, focused, ready, used the same
camera `[-42, 72]`, and retained one geometry identity. This passes the
predeclared 90% relative-cadence and 33.33 ms p50 limits.

## Correctness and gate evidence

- Loader tests passed 5/5, including real same-filename A→B descriptor hashes
  and corrupt-byte rejection.
- Browser cache tests passed 2/2: a fresh manifest transferred on reload while
  every shared hash-qualified payload was a cache hit, and a routed corrupt
  core was rejected with the surface withheld.
- Replacing the App cache choice with `no-store` made the warm reload test fail
  with every shared package payload retransferred; restoration passed.
- The deterministic gate passed 31 files / 135 tests, the production build,
  and 1,187 artifact descriptors at 43.70 MiB.
- The full browser run passed 25/26 cases. Its one failed test canceled an
  Amazon camera transition before reaching the authored target; after the test
  waited for `[-62, -4]`, that unchanged product path passed 1/1. The composed
  browser coverage is 26/26 without a retry claim for the original fixture.

The final entry asset is `index-ClbnCUE6.js`, 1,315,521 bytes, SHA-256
`7646f0ffd3c368d4e9485b2f62f629512e1898c912ad1dda9b119451f764e5ca`.
The compact JSON preserves every sample, stop rule, artifact identity, guard,
and the exact scratch evidence hashes.
