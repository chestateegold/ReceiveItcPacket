const zmq = require("zeromq");

async function run() {
    const sock = new zmq.Subscriber();

    sock.connect("tcp://itcmon.local:18002"); // Replace with your zjpub port
    sock.subscribe();                      // Subscribe to all messages

    console.log("Listening...");

    for await (const msg of sock) {
        console.log(msg.toString());
    }
}

run().catch(console.error);
