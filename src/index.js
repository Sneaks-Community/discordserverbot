/** The only place that ends the process over a startup failure. */

import { initBot } from "./bot.js";
import { ConfigError } from "./config/index.js";
import { closeDB } from "./db/index.js";
import { flushLogs, mainLogger } from "./utils/logger.js";

initBot().catch(async err => {
    if (err instanceof ConfigError) {
        // A stack trace says nothing about a mistyped variable; the messages are the diagnostic.
        mainLogger.fatal({ errors: err.errors }, err.message);
    } else {
        mainLogger.fatal({ err }, "Failed to initialize bot");
    }

    // initDB may already have run, and a connection left open skips SQLite's WAL
    // checkpoint. A no-op when the failure came before initDB.
    try {
        closeDB();
    } catch (dbError) {
        mainLogger.error({ err: dbError }, "Failed to close the database during startup exit");
    }

    // Drain the errors above before exit kills the transport worker.
    await flushLogs();

    process.exit(1);
});
