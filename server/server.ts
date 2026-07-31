#!/usr/bin/env node
import util from "node:util";
import {
	StreamMessageReader,
	StreamMessageWriter,
	IPCMessageReader,
	IPCMessageWriter,
} from "vscode-jsonrpc/node";
import type { MessageWriter } from "../node_modules/vscode-jsonrpc/lib/common/messageWriter.js";
import type { MessageReader } from "../node_modules/vscode-jsonrpc/lib/common/messageReader.js";

import { WebSocketServer, WebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";

interface CliOptions {
	port: number;
}

interface LanguageServerResult {
	processHandle: ChildProcess;
	reader: MessageReader;
	writer: MessageWriter;
}

const { port } = parseCliOptions();

const wss = new WebSocketServer({ port });

console.log(`🔌 LSP bridge running at ws://localhost:${port}`);

wss.on("connection", (ws: WebSocket, req) => {
	const url = new URL(`http://${req.headers.host}${req.url}`);

	const endpoint = url.pathname.slice(1);
	const params = Object.fromEntries(url.searchParams.entries());

	console.log(`⚙️  New connection: ${endpoint}`, params);

	try {
		const args = parseArgs(params.args);

		if (args.length === 0) {
			throw new Error("Missing ?args= parameter");
		}

		const command = args.shift()!;
		const type = params.type ?? "stdio";
		const root = params.root ?? process.cwd();

		const { processHandle, reader, writer } = startLanguageServer(
			command,
			args,
			type,
			endpoint,
			root,
			ws
		);

		// LSP -> WebSocket
		reader.listen((message: any) => {
			ws.send(JSON.stringify(message));
		});

		// WebSocket -> LSP
		ws.on("message", (raw) => {
			try {
				const msg = JSON.parse(raw.toString());

				writer.write(msg);

				console.log(`➡️  [${endpoint}] From WebSocket → LSP:\n`, util.inspect(msg, {
					depth: null,
					colors: true
				}));
			} catch (err) {
				console.error(`❌ Invalid message from ${endpoint}:`, err);
			}
		});

		ws.on("close", () => {
			console.log(`🔌 ${endpoint} WebSocket closed`);

			if (processHandle && !processHandle.killed) {
				processHandle.kill();
			}
		});
	} catch (err) {
		const error = err as Error;

		console.error(`❌ Failed to handle ${endpoint}:`, error);

		ws.send(
			JSON.stringify({
				error: error.message,
			})
		);

		ws.close();
	}
});

function parseCliOptions(): CliOptions {
	const cliArgs = process.argv.slice(2);

	if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
		console.log(`
ws-lsp-bridge CLI

Usage:
  wslsp [options]

Options:
  --port, -p <number>       Port for WebSocket server (default: 3030)
  --help, -h                Show this help
`);

		process.exit(0);
	}

	const portIndex = cliArgs.findIndex((arg) =>
		["--port", "-p"].includes(arg)
	);

	const port =
		portIndex >= 0
			? Number(cliArgs[portIndex + 1])
			: Number(process.env.PORT) || 3030;

	return { port };
}

function parseArgs(str: string = ""): string[] {
	return str
		.split(/[\s,]+/)
		.map((a) => a.trim())
		.filter(Boolean);
}

function startLanguageServer(
	command: string,
	args: string[],
	type: string,
	endpoint: string,
	cwd: string,
	ws?: WebSocket
): LanguageServerResult {
	console.log(
		`🚀 Starting ${endpoint} server: ${command} ${args.join(" ")} (${type})`
	);

	const opts: any = {
		cwd,
		env: process.env,
	};

	if (type === "ipc") {
		opts.stdio = ["pipe", "pipe", "pipe", "ipc"];
	}

	const processHandle = spawn(command, args, opts);

	const reader =
		(type === "ipc"
			? new IPCMessageReader(processHandle)
			: new StreamMessageReader(processHandle.stdout!)
		) as MessageReader;

	const writer =
		(type === "ipc"
			? new IPCMessageWriter(processHandle)
			: new StreamMessageWriter(processHandle.stdin!)
		) as MessageWriter;

	processHandle.stderr?.on("data", (data: Buffer) => {
		console.error(`[${endpoint}] stderr: ${data}`);
	});

	processHandle.on("error", (err: Error) => {
		console.error(`[${endpoint}] failed to start:`, err);

		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.close(1011, `Failed to start ${endpoint}: ${err.message}`);
		}
	});

	processHandle.on("exit", (code) => {
		console.log(`[${endpoint}] exited with code ${code}`);
	});

	return {
		processHandle,
		reader,
		writer,
	};
}