import winston from "winston";
import config from "../config/config";

const logFormat = winston.format.combine(
	winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
	winston.format.errors({ stack: true }),
	winston.format.printf(({ timestamp, level, message, ...metadata }) => {
		let msg = `${timestamp} [${level}]: ${message}`;
		if (Object.keys(metadata).length > 0) {
			msg += ` ${JSON.stringify(metadata)}`;
		}
		return msg;
	})
);

const logger = winston.createLogger({
	level: config.logging.level,
	format: logFormat,
	transports: [
		new winston.transports.Console({
			format: winston.format.combine(winston.format.colorize(), logFormat),
		}),
	],
});

if (config.server.environment === "production") {
	logger.add(
		new winston.transports.File({
			filename: "logs/error.log",
			level: "error",
			format: logFormat,
		})
	);

	logger.add(
		new winston.transports.File({
			filename: "logs/combined.log",
			format: logFormat,
		})
	);
}

export class BotLogger {
	private context: string;

	constructor(context: string) {
		this.context = context;
	}

	private formatMessage(message: string): string {
		return `[${this.context}] ${message}`;
	}

	info(message: string, metadata?: any): void {
		logger.info(this.formatMessage(message), metadata);
	}

	warn(message: string, metadata?: any): void {
		logger.warn(this.formatMessage(message), metadata);
	}

	error(message: string, error?: Error | any): void {
		logger.error(this.formatMessage(message), {
			error: error?.message || error,
			stack: error?.stack,
		});
	}

	debug(message: string, metadata?: any): void {
		logger.debug(this.formatMessage(message), metadata);
	}
}

export default logger;
