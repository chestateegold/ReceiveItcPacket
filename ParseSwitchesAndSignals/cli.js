const { parseSwitchesAndSignals } = require("./parseSwitchesAndSignals");

const rr = process.argv[2];
const data = process.argv[3];

if (!rr || !data) {
    console.error("Usage: node ParseSwitchesAndSignals/cli.js <rr> <data>");
    process.exitCode = 1;
} else {
    const result = parseSwitchesAndSignals(rr, data);
    console.log(JSON.stringify(result, null, 4));
}
