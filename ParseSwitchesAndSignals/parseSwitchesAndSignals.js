const config = require("./railroadConfig.json");

function parseSwitchesAndSignals(rr, data) {
    const rrConfig = config.find(c => c.rr === rr);
    if (!rrConfig) {
        return { success: "no", results: [] };
    }

    const { switchBytesFirst, reverseSignalBits, signals } = rrConfig;
    const validSignalSet = new Set(Object.keys(signals).map(Number));

    let hexStr;
    if (typeof data === "number") {
        hexStr = data.toString(16);
    } else {
        hexStr = data;
    }

    const bitStr = hexStr.split("").map(ch =>
        parseInt(ch, 16).toString(2).padStart(4, "0")
    ).join("");

    const bitLen = bitStr.length;

    function naturalScan() {
        let count = 0;
        let i = 0;
        while (i + 1 < bitLen) {
            const chunk = bitStr.substring(i, i + 2);
            if (chunk === "01" || chunk === "10") {
                count++;
                i += 2;
            } else {
                break;
            }
        }
        return count;
    }

    function validate(s) {
        if (switchBytesFirst) {
            const switchBits = s * 2;
            if (switchBits > bitLen) return null;
            for (let i = 0; i < switchBits; i += 2) {
                const chunk = bitStr.substring(i, i + 2);
                if (chunk !== "01" && chunk !== "10") return null;
            }
            const signalBits = bitStr.substring(switchBits);
            return validateSignals(signalBits);
        } else {
            const signalBits = bitStr.substring(0, bitLen - s * 2);
            const signalCount = validateSignals(signalBits);
            if (signalCount === null) return null;
            const switchBits = bitStr.substring(bitLen - s * 2);
            for (let i = 0; i < switchBits.length; i += 2) {
                const chunk = switchBits.substring(i, i + 2);
                if (chunk !== "01" && chunk !== "10") return null;
            }
            return signalCount;
        }
    }

    function validateSignals(signalBits) {
        let signalCount = 0;
        for (let i = 0; i + 5 <= signalBits.length; i += 5) {
            let chunk = signalBits.substring(i, i + 5);
            if (reverseSignalBits) {
                chunk = chunk.split("").reverse().join("");
            }
            const val = parseInt(chunk, 2);
            if (val === 0) continue;
            if (!validSignalSet.has(val)) return null;
            signalCount++;
        }
        return signalCount;
    }

    const sNatural = naturalScan();
    const maxS = Math.floor(bitLen / 2);

    const validResults = [];

    const sVal0 = validate(sNatural);
    if (sVal0 !== null) {
        validResults.push({ switches: String(sNatural), signals: String(sVal0) });
    }

    for (let s = sNatural - 1; s >= 0; s--) {
        const sVal = validate(s);
        if (sVal === null) break;
        validResults.push({ switches: String(s), signals: String(sVal) });
    }

    for (let s = sNatural + 1; s <= maxS; s++) {
        const sVal = validate(s);
        if (sVal === null) break;
        validResults.push({ switches: String(s), signals: String(sVal) });
    }

    if (validResults.length === 1) {
        return { success: "yes", results: validResults[0] };
    } else if (validResults.length === 0) {
        return { success: "no", results: [] };
    } else {
        return { success: "ambiguous", results: [] };
    }
}

function runSelfTest() {
    const assert = require("assert");

    // BNSF (rr=076) intermediate, no switches
    const result1 = parseSwitchesAndSignals("076", 0b0111011000000000);

    assert.strictEqual(result1.success, "yes");
    assert.deepStrictEqual(result1.results, {
        switches: "0",
        signals: "2"
    });

    // BNSF (rr=076) control point, 1 switch 3 signals
    const result2 = parseSwitchesAndSignals("076", 0b011100011110111100000000);

    assert.strictEqual(result2.success, "yes");
    assert.deepStrictEqual(result2.results, {
        switches: "1",
        signals: "3"
    });

    // UP (rr=802) ambiguous: 0101111100000000 has 2 valid interpretations
    const result3 = parseSwitchesAndSignals("802", 0b0101111100000000);

    assert.strictEqual(result3.success, "ambiguous");

    // nonsense and garbled. expecting a failure
    const result4 = parseSwitchesAndSignals("802", 0b1100011111000000);

    assert.strictEqual(result4.success, "no");

    console.log("Self-test passed.");
}

if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 1 && args[0] === "--self-test") {
        runSelfTest();
        return;
    }

    if (args.length === 2) {
        const result = parseSwitchesAndSignals(args[0], args[1]);
        console.log(JSON.stringify(result, null, 4));
        return;
    }

    console.error("Usage: node ParseSwitchesAndSignals/parseSwitchesAndSignals.js <rr> <data>");
    console.error("       node ParseSwitchesAndSignals/parseSwitchesAndSignals.js --self-test");
    process.exitCode = 1;
}

module.exports = { parseSwitchesAndSignals, runSelfTest };
