# Plan: Deterministic Switch/Signal Decoding

## Overview

Implement the `parseSwitchesAndSignals(address, data)` function in `ParseSwitchesAndSignals/parseSwitchesAndSignals.js` to deterministically decode the number of switches and signals in a binary packet.

## Algorithm

### 1. Railroad Identification

Extract the railroad ID from the address string. The rr is the 2nd, 3rd, and 4th characters (0-indexed positions 1, 2, 3). Example:

- `"707647404405"` → rr = `"076"` (BNSF)
- `"780221900803"` → rr = `"802"` (UP)

Load the matching entry from `./railroadConfig.json`. It provides:
- `switchBytesFirst` (boolean)
- `reverseSignalBits` (boolean)
- `signals` (object mapping decimal values to human-readable names)

### 2. Data Conversion

The `data` parameter is a hex string. Convert it to a binary bit string:

- Each hex character → 4 bits, using `parseInt(hexChar, 16).toString(2).padStart(4, '0')`
- Concatenate in order; result is byte-aligned (multiple of 8 bits)

### 3. Core Crawl Algorithm

**Direction:** MSB-first (left to right) for both switch scanning and signal reading.

#### Step A: Natural Scan

Scan 2-bit groups from the start of the bit string:
- `"01"` or `"10"` → count as a switch, advance 2 bits
- `"00"` or `"11"` → signal delimiter, **stop scanning**
- This yields the natural switch count: `sNatural`

#### Step B: Crawl Outward

Starting from `sNatural`, try validating with signal decoding. Then crawl outward until validation fails:

1. Try `s = sNatural` → validate (see Step C). If valid, record it.
2. Crawl down: try `s = sNatural - 1, sNatural - 2, ...` down to 0. **Stop when a candidate fails.**
3. Crawl up: try `s = sNatural + 1, sNatural + 2, ...` up to `floor(bitLength / 2)`. **Stop when a candidate fails.**
4. Collect **all** valid `s` values.

#### Step C: Validation for a Candidate `s`

**`switchBytesFirst = true`** (switches come first in binary):
- **Switches section:** first `s * 2` bits. Each 2-bit group must be `"01"` or `"10"`. Vacuously true when `s = 0`.
- **Signals section:** remaining bits after switch section → split into consecutive 5-bit groups (aligned from the start of the remaining bits).
  - If `reverseSignalBits` is `true`: reverse each 5-bit chunk before interpreting as a number.
  - Parse each group as a 5-bit integer (`parseInt(chunk, 2)`).
  - `00000` (value `0`) is a terminator — skip it.
  - All non-zero values must exist as a **key** in the railroad's `signals` map. Parse keys as integers for comparison.
  - Count non-zero groups → signal count.
- Candidate is valid if all non-zero signal groups pass the map check AND at least one signal was found.

**`switchBytesFirst = false`** (signals come first in binary):
- **Signals section:** first `bitLength - s * 2` bits. Same 5-bit group validation as above.
- **Switches section:** last `s * 2` bits. Each 2-bit group must be `"01"` or `"10"`.
- Same validation rules, just inverted ordering.

### 4. Return Value

- **Exactly 1 valid `s`:**  
  `{ success: "yes", results: { switches: "<s>", signals: "<signalCount>" } }`
- **Multiple valid `s`:**  
  `{ success: "ambiguous", results: [] }`  
  (or include all valid combos if you prefer — current stub returns an array for results)
- **0 valid `s`:**  
  `{ success: "no", results: [] }`

Note: the existing `runSelfTest` expects `results` to be an object like `{ switches: "0", signals: "2" }` for the success case, and checks `result.success === "yes"`. The function signature returns `{ success, results }`.

### 5. Self-Test Cases

These are already written in `runSelfTest()`. Make them pass (update comments — both are BNSF, rr=076):

| Test | Address | Data (hex) | Data (binary) | Expected switches | Expected signals |
|------|---------|------------|----------------|-------------------|------------------|
| 1 | `"707647404405"` | `"7600"` | `0111011000000000` | `"0"` | `"2"` |
| 2 | `"780221900803"` | `"71EF00"` | `011100011110111100000000` | `"1"` | `"3"` |

**Note:** The current self-test passes data as a JavaScript number using `0b` prefix. The implementation should handle this by converting to hex first (or by using `toString(2).padStart(...)` for binary), since the real CLI passes data as a string. One approach: accept both, use `typeof data === 'number' ? data.toString(16) : data`.

### 6. Ambiguous Case (for future test)

Binary `0101111100000000` with UP (rr=802, `reverseSignalBits: false`) yields s ∈ {0, 1, 2} all valid → should return `"ambiguous"`.

## Implementation Checklist

1. [ ] Load `railroadConfig.json` (require it at the top of the file)
2. [ ] Extract rr from address (`address.slice(1, 4)` or `address.substring(1, 4)`)
3. [ ] Look up railroad config entry matching the rr
4. [ ] Build a `Set` of valid signal values from the config's `signals` keys (parse as integers)
5. [ ] Convert data to binary bit string (handle both number and string input)
6. [ ] Implement natural scan: iterate 2-bit chunks counting switches until `"00"` or `"11"`
7. [ ] Implement validation for a given `s` (switch count)
8. [ ] Implement crawl: start at sNatural, go down, go up, collect valid s values
9. [ ] Return result based on count of valid s values
10. [ ] Verify `npm run test-switches` passes
