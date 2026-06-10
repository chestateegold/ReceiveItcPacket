const fs = require("fs");
const path = require("path");
const zmq = require("zeromq");

const endpoint = process.env.ZMQ_ENDPOINT || "tcp://localhost:18001";
const outputFile = process.env.CSV_FILE || path.join(__dirname, "packets.csv");

function ensureCsvHeader(filePath) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        fs.writeFileSync(filePath, "proto,type,wiuid,data\n", "utf8");
    }
}

function hexToBinaryString(hex) {
    if (typeof hex !== "string" || hex.length === 0) {
        return "";
    }

    const normalized = hex.trim();
    const evenLength = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
    const bytes = evenLength.match(/.{1,2}/g) || [];

    return bytes
        .map((byte) => {
            const value = Number.parseInt(byte, 16);
            if (Number.isNaN(value)) {
                return "";
            }
            return value.toString(2).padStart(8, "0");
        })
        .join(" ");
}

function csvEscape(value) {
    const text = value == null ? "" : String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function appendPacketRow(packet) {
    const row = [
        csvEscape(packet.proto),
        csvEscape(packet.type),
        csvEscape(packet.WIUID),
        csvEscape(hexToBinaryString(packet.data)),
    ].join(",");
    console.log(row);
    fs.appendFileSync(outputFile, `${row}\n`, "utf8");
}

async function main() {
    ensureCsvHeader(outputFile);

    const subscriber = new zmq.Subscriber();
    subscriber.connect(endpoint);
    subscriber.subscribe();

    console.log(`ZMQ subscriber started: ${endpoint}`);
    console.log(`Writing CSV rows to: ${outputFile}`);

    try {
        for await (const [message] of subscriber) {
            const msgText = Buffer.isBuffer(message) ? message.toString("utf8") : String(message);

            try {
                const packet = JSON.parse(msgText);
                appendPacketRow(packet);
            } catch (error) {
                console.error("Skipping invalid packet:", msgText);
            }
        }
    } finally {
        subscriber.close();
    }
}

main().catch((error) => {
    console.error("Receiver failed:", error);
    process.exitCode = 1;
});
