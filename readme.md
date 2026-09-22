These are just some ad hoc programs that I vibe coded up for use with ItcMon

Ensure you have node.js installed

1) run `npm i` to download the dependencies
2) change the arguments in package.json's parse-packets script to point to the packets.hex folder you're looking for
3) run `npm run parse-packets` in the command line

To count packet types from all configured channel publishers, run
`npm run count-packet-types`. The subscriber list is in
`zmq/servers.json`; each enabled server is connected independently. The
counter reads the fourth byte of each raw packet, tracks only x33 and x34 by
server name, and prints a cumulative summary every 1,000 packets. At each
checkpoint it overwrites `zmq/packet-type-counts.csv`. Set `ZMQ_SERVERS_FILE`
to use a different server-list file.
