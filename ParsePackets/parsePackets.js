#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const POLL_INTERVAL_MS = 1000;
const CSV_HEADER = [
    "read_timestamp",
    "original_packet_hex",
    "header_hex",
    "packet_type",
    "flags_reserved",
    "address_hex",
    "decimal_address",
    "metadata_hex",
    "declared_length_bytes",
    "actual_length_bytes",
    "length_field_matches",
    "data_hex",
    "binary_data",
];

function normalizeHex(value) {
    return String(value || "").replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

function hexToBinaryString(hex) {
    if (!hex) {
        return "";
    }

    const bytes = hex.match(/.{1,2}/g) || [];
    return bytes
        .map((byte) => Number.parseInt(byte, 16).toString(2).padStart(8, "0"))
        .join(" ");
}

function csvEscape(value) {
    const text = value == null ? "" : String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function extractHexCandidates(line) {
    return (line.match(/[0-9A-Fa-f]{18,}/g) || [])
        .map(normalizeHex)
        .filter((candidate) => candidate.length % 2 === 0);
}

function parsePacket(packetHex) {
    const normalized = normalizeHex(packetHex);
    if (normalized.length < 24) {
        throw new Error("packet is too short to contain the fixed header and metadata");
    }

    const headerHex = normalized.slice(0, 4);
    const packetType = normalized.slice(4, 6);
    const flagsReserved = normalized.slice(6, 8);
    const addressHex = normalized.slice(8, 18);
    const metadataHex = normalized.slice(18, 24);
    const dataHex = normalized.slice(24);
    const decimalAddress = BigInt(`0x${addressHex}`);
    const declaredLengthBytes = Number.parseInt(headerHex, 16);
    const actualLengthBytes = normalized.length / 2;
    const lengthFieldMatches = declaredLengthBytes === actualLengthBytes + 2;

    return {
        originalPacketHex: normalized,
        headerHex,
        packetType,
        flagsReserved,
        addressHex,
        decimalAddress: decimalAddress.toString(),
        metadataHex,
        declaredLengthBytes,
        actualLengthBytes,
        lengthFieldMatches,
        dataHex,
        binaryData: hexToBinaryString(dataHex),
    };
}

function packetToCsvRow(packet, readTimestamp) {
    return [
        readTimestamp,
        packet.originalPacketHex,
        packet.headerHex,
        packet.packetType,
        packet.flagsReserved,
        packet.addressHex,
        packet.decimalAddress,
        packet.metadataHex,
        packet.declaredLengthBytes,
        packet.actualLengthBytes,
        packet.lengthFieldMatches,
        packet.dataHex,
        packet.binaryData,
    ].map(csvEscape).join(",");
}

function ensureOutputDirectory(outputPath) {
    const directory = path.dirname(outputPath);
    fs.mkdirSync(directory, { recursive: true });
}

function initializeFilePositionFromSize(state, size) {
    state.offset = size;
    state.pendingText = "";
}

function initializeFilePosition(inputPath, state) {
    const stats = fs.statSync(inputPath);
    initializeFilePositionFromSize(state, stats.size);
}

function processTextChunk(chunkText, state, outputStream) {
    const combinedText = state.pendingText + chunkText;
    const lines = combinedText.split(/\r?\n/);
    state.pendingText = lines.pop() || "";

    for (const line of lines) {
        state.lineNumber += 1;
        processLine(line, state, outputStream);
    }
}

function processLine(line, state, outputStream) {
    const candidates = extractHexCandidates(line);
    if (candidates.length === 0) {
        state.warningCount += 1;
        console.error(`Line ${state.lineNumber}: no valid hex packet found`);
        return;
    }

    const readTimestamp = new Date().toISOString();
    for (const candidate of candidates) {
        try {
            const parsed = parsePacket(candidate);
            outputStream.write(`${packetToCsvRow(parsed, readTimestamp)}\n`);
            state.parsedCount += 1;
        } catch (error) {
            state.warningCount += 1;
            console.error(`Line ${state.lineNumber}: skipped candidate ${candidate} (${error.message})`);
        }
    }
}

function flushPendingLine(state, outputStream) {
    if (!state.pendingText) {
        return;
    }

    state.lineNumber += 1;
    processLine(state.pendingText, state, outputStream);
    state.pendingText = "";
}

async function readChunk(inputPath, start, end) {
    return new Promise((resolve, reject) => {
        if (end < start) {
            resolve("");
            return;
        }

        const stream = fs.createReadStream(inputPath, {
            encoding: "utf8",
            start,
            end,
        });

        let content = "";
        stream.on("data", (chunk) => {
            content += chunk;
        });
        stream.on("end", () => resolve(content));
        stream.on("error", reject);
    });
}

async function processFileRange(inputPath, startOffset, endOffset, state, outputStream) {
    const chunkText = await readChunk(inputPath, startOffset, endOffset - 1);
    processTextChunk(chunkText, state, outputStream);
}

async function processInitialFile(inputPath, state, outputStream) {
    initializeFilePosition(inputPath, state);
}

async function pollForChanges(inputPath, state, outputStream) {
    const stats = fs.statSync(inputPath);

    if (stats.size < state.offset) {
        state.offset = 0;
        state.pendingText = "";
        console.log("Input file was truncated or rotated; restarting from the beginning.");
    }

    if (stats.size === state.offset) {
        return;
    }

    await processFileRange(inputPath, state.offset, stats.size, state, outputStream);
    state.offset = stats.size;
}

async function watchLogFile(inputPath, outputPath) {
    ensureOutputDirectory(outputPath);

    const outputStream = fs.createWriteStream(outputPath, { encoding: "utf8" });
    outputStream.write(`${CSV_HEADER.join(",")}\n`);

    const state = {
        lineNumber: 0,
        offset: 0,
        parsedCount: 0,
        pendingText: "",
        warningCount: 0,
    };

    await processInitialFile(inputPath, state, outputStream);

    console.log(`Watching ${inputPath} for new packets every ${POLL_INTERVAL_MS} ms.`);
    console.log(`Writing parsed packets to ${outputPath}.`);

    const interval = setInterval(async () => {
        try {
            await pollForChanges(inputPath, state, outputStream);
        } catch (error) {
            state.warningCount += 1;
            console.error(`Polling failed: ${error.message}`);
        }
    }, POLL_INTERVAL_MS);

    const shutdown = async () => {
        clearInterval(interval);
        flushPendingLine(state, outputStream);
        outputStream.end();
        await new Promise((resolve) => outputStream.on("finish", resolve));
        console.log(`Stopped. Parsed ${state.parsedCount} packet row(s). Warnings: ${state.warningCount}.`);
        process.exit(0);
    };

    process.on("SIGINT", () => {
        void shutdown();
    });
    process.on("SIGTERM", () => {
        void shutdown();
    });

    return new Promise(() => {});
}

function runSelfTest() {
    const packetA = parsePacket("00113300B5A8D9673B020C469F7BCF");
    assert.strictEqual(packetA.addressHex, "B5A8D9673B");
    assert.strictEqual(packetA.decimalAddress, "780221900603");
    assert.strictEqual(packetA.metadataHex, "020C46");
    assert.strictEqual(packetA.dataHex, "9F7BCF");
    assert.strictEqual(packetA.binaryData, "10011111 01111011 11001111");
    assert.strictEqual(packetA.lengthFieldMatches, true);

    const packetB = parsePacket("00133300B5A8D9667302031255F7BDEF78");
    assert.strictEqual(packetB.addressHex, "B5A8D96673");
    assert.strictEqual(packetB.decimalAddress, "780221900403");
    assert.strictEqual(packetB.metadataHex, "020312");
    assert.strictEqual(packetB.dataHex, "55F7BDEF78");
    assert.strictEqual(packetB.binaryData, "01010101 11110111 10111101 11101111 01111000");
    assert.strictEqual(packetB.lengthFieldMatches, true);

    const packetC = parsePacket("00153300B5A8D966D78207BFA595F7BDEF7BC0");
    assert.strictEqual(packetC.addressHex, "B5A8D966D7");
    assert.strictEqual(packetC.decimalAddress, "780221900503");
    assert.strictEqual(packetC.metadataHex, "8207BF");
    assert.strictEqual(packetC.dataHex, "A595F7BDEF7BC0");
    assert.strictEqual(packetC.binaryData, "10100101 10010101 11110111 10111101 11101111 01111011 11000000");
    assert.strictEqual(packetC.lengthFieldMatches, true);

    const packetD = parsePacket("000F3300A4C3E07A2D8207F580");
    assert.strictEqual(packetD.addressHex, "A4C3E07A2D");
    assert.strictEqual(packetD.decimalAddress, "707660905005");
    assert.strictEqual(packetD.metadataHex, "8207F5");
    assert.strictEqual(packetD.dataHex, "80");
    assert.strictEqual(packetD.binaryData, "10000000");
    assert.strictEqual(packetD.lengthFieldMatches, true);

    const packetE = parsePacket("00153300B5A8D966D7020B435595F7BDE7BDE0");
    assert.strictEqual(packetE.addressHex, "B5A8D966D7");
    assert.strictEqual(packetE.decimalAddress, "780221900503");
    assert.strictEqual(packetE.metadataHex, "020B43");
    assert.strictEqual(packetE.dataHex, "5595F7BDE7BDE0");
    assert.strictEqual(packetE.binaryData, "01010101 10010101 11110111 10111101 11100111 10111101 11100000");
    assert.strictEqual(packetE.lengthFieldMatches, true);

    const embedded = extractHexCandidates("[2026-06-09 15:00:00] RX 00133300B5A8D9667302031255F7BDEF78");
    assert.deepStrictEqual(embedded, ["00133300B5A8D9667302031255F7BDEF78"]);

    const state = {
        lineNumber: 0,
        offset: 0,
        parsedCount: 0,
        pendingText: "",
        warningCount: 0,
    };
    const writes = [];
    const fakeOutput = {
        write(text) {
            writes.push(text);
        },
    };

    processTextChunk("00133300B5A8D9667302031255F7BDEF78\n00113300B5A8D9673B020C469F7BCF", state, fakeOutput);
    assert.strictEqual(state.lineNumber, 1);
    assert.strictEqual(state.pendingText, "00113300B5A8D9673B020C469F7BCF");
    assert.strictEqual(state.parsedCount, 1);
    assert.ok(writes[0].includes(",00133300B5A8D9667302031255F7BDEF78,"));

    flushPendingLine(state, fakeOutput);
    assert.strictEqual(state.lineNumber, 2);
    assert.strictEqual(state.pendingText, "");
    assert.strictEqual(state.parsedCount, 2);

    const startupState = {
        lineNumber: 0,
        offset: 0,
        parsedCount: 0,
        pendingText: "stale",
        warningCount: 0,
    };
    initializeFilePositionFromSize(startupState, 1234);
    assert.strictEqual(startupState.offset, 1234);
    assert.strictEqual(startupState.pendingText, "");
    assert.strictEqual(startupState.parsedCount, 0);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 1 && args[0] === "--self-test") {
        runSelfTest();
        console.log("Self-test passed.");
        return;
    }

    if (args.length !== 2) {
        console.error("Usage: node ParsePackets\\parsePackets.js input.log output.csv");
        process.exitCode = 1;
        return;
    }

    const [inputPath, outputPath] = args;

    try {
        await watchLogFile(inputPath, outputPath);
    } catch (error) {
        console.error(`Failed to watch packets: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    void main();
}

module.exports = {
    extractHexCandidates,
    flushPendingLine,
    hexToBinaryString,
    parsePacket,
    processTextChunk,
    runSelfTest,
    watchLogFile,
};
