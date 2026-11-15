/** The bundle's entry: runs the CLI with the process's arguments and sets its exit code. */
import { run } from './main';

process.exitCode = await run(process.argv.slice(2));
