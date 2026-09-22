const fs = require("fs");
const path = require("path");
const zmq = require("zeromq");

const serversFile = process.env.ZMQ_SERVERS_FILE || path.join(__dirname, "servers.json");
const outputFile = path.join(__dirname, "packet-type-counts.csv");

function loadServers() {
    const config = JSON.parse(fs.readFileSync(serversFile, "utf8"));

    if (!config || !Array.isArray(config.servers) || config.servers.length === 0) {
        throw new Error(`No servers configured in ${serversFile}`);
    }

    return config.servers.filter((server) => server.enabled !== false);
}

function getPacketType(message) {
    if (!message || message.length < 4) {
        return null;
    }

    return message[3];
}

function getActiveServers(counts) {
    return [...counts.entries()]
        .filter(([, packetCounts]) => packetCounts.x33 > 0 || packetCounts.x34 > 0)
        .sort(([nameA], [nameB]) => nameA.localeCompare(nameB, undefined, { numeric: true }));
}

function writeSummaryCsv(counts) {
    const lines = ["name,x33,x34"];

    for (const [name, packetCounts] of getActiveServers(counts)) {
        lines.push(`${name},${packetCounts.x33},${packetCounts.x34}`);
    }

    fs.writeFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
}

function printSummary(totalPackets, counts) {
    console.log(`\nSummary after ${totalPackets} packets:`);

    const servers = getActiveServers(counts);

    if (servers.length === 0) {
        console.log("  No x33 or x34 packets received.");
        return;
    }

    for (const [name, packetCounts] of servers) {
        console.log(`  ${name}: x33=${packetCounts.x33}, x34=${packetCounts.x34}`);
    }
}

async function listenAndCount(server, counts, state, socket) {
    const endpoint = `tcp://${server.ip}:${server.port}`;
    socket.connect(endpoint);
    socket.subscribe();
    console.log(`Listening: ${server.name} (${endpoint})`);

    for await (const [message] of socket) {
        state.totalPackets += 1;

        const packetType = getPacketType(message);
        if (packetType === 0x33 || packetType === 0x34) {
            const serverCounts = counts.get(server.name) || { x33: 0, x34: 0 };
            serverCounts[packetType === 0x33 ? "x33" : "x34"] += 1;
            counts.set(server.name, serverCounts);
        }

        if (state.totalPackets % 100 === 0) {
            printSummary(state.totalPackets, counts);
            writeSummaryCsv(counts);
            console.log(`Wrote cumulative counts to ${outputFile}`);
        }
    }
}

async function countPacketTypes() {
    const servers = loadServers();
    const counts = new Map();
    const state = { totalPackets: 0 };
    const sockets = servers.map(() => new zmq.Subscriber());
    const closeSockets = () => sockets.forEach((socket) => socket.close());

    process.once("SIGINT", closeSockets);
    process.once("SIGTERM", closeSockets);
    console.log(`Starting ${servers.length} packet-type counters from ${serversFile}`);

    try {
        await Promise.all(servers.map((server, index) =>
            listenAndCount(server, counts, state, sockets[index])));
    } finally {
        closeSockets();
    }
}

module.exports = { countPacketTypes };

if (require.main === module) {
    countPacketTypes().catch((error) => {
        console.error("Packet-type counter failed:", error);
        process.exitCode = 1;
    });
}
