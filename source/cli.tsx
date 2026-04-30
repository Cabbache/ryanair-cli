#!/usr/bin/env node
import React from 'react';
import {render, Text} from 'ink';
import meow from 'meow';
import {createStreamLogger, type Logger} from '@ryanair-cli/api';
import LoginCommand from './commands/login.js';
import FlightsCommand from './commands/flights.js';
import BoardingPassCommand from './commands/boardingpass.js';

const cli = meow(
	`
	Usage
	  $ ryanair-cli <command>

	Commands
	  login                  Sign in and store the session locally
	  flights                List your active (upcoming) flights
	  boardingpass <PNR>     Render boarding pass(es) (Aztec) for a booking

	Options
	  --debug  Log every request/response to stderr (one JSON line each).
	           Without --debug, only "unexpected" events (signs the API
	           may have changed) are logged.

	Examples
	  $ ryanair-cli login
	  $ ryanair-cli flights
	  $ ryanair-cli boardingpass XXXXXX
	  $ ryanair-cli boardingpass XXXXXX --debug 2> debug.log
`,
	{
		importMeta: import.meta,
		flags: {
			debug: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

const verbose = cli.flags.debug || process.env['RYANAIR_CLI_DEBUG'] === '1';

const logger: Logger = createStreamLogger({
	write: line => process.stderr.write(line),
	verbose,
});

const cmd = cli.input[0];

switch (cmd) {
	case 'login': {
		render(<LoginCommand logger={logger} />);
		break;
	}

	case 'flights': {
		render(<FlightsCommand logger={logger} />);
		break;
	}

	case 'boardingpass': {
		const pnr = cli.input[1];
		if (!pnr) {
			render(
				<Text>
					Missing PNR. Usage: <Text bold>ryanair-cli boardingpass &lt;PNR&gt;</Text>
				</Text>,
			);
			process.exitCode = 1;
			break;
		}
		render(<BoardingPassCommand pnr={pnr} logger={logger} />);
		break;
	}

	default: {
		render(
			<Text>
				{cmd ? `Unknown command: ${cmd}` : 'No command given.'} Run with --help.
			</Text>,
		);
		process.exitCode = cmd ? 1 : 0;
	}
}
