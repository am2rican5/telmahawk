#!/usr/bin/env bun

import { KnowledgeIngestionService } from '../src/services/knowledge-ingestion.service';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { Glob } from 'bun';

class ProgressBar {
	private startTime: number = Date.now();
	private lastUpdate: number = 0;
	
	constructor(
		private total: number,
		private width: number = 40,
		private showETA: boolean = true
	) {}
	
	update(current: number, label?: string) {
		const now = Date.now();
		if (now - this.lastUpdate < 100 && current < this.total) return;
		this.lastUpdate = now;
		
		const percentage = Math.min(current / this.total, 1);
		const filled = Math.round(this.width * percentage);
		const empty = this.width - filled;
		
		const bar = '█'.repeat(filled) + '░'.repeat(empty);
		const percent = (percentage * 100).toFixed(1);
		
		let line = `\r[${bar}] ${percent}% (${current}/${this.total})`;
		
		if (this.showETA && current > 0) {
			const elapsed = (now - this.startTime) / 1000;
			const rate = current / elapsed;
			const remaining = this.total - current;
			const eta = remaining / rate;
			
			line += ` ETA: ${this.formatTime(eta)}`;
		}
		
		if (label) {
			line += ` - ${label}`;
		}
		
		process.stdout.write(line);
		
		if (current >= this.total) {
			console.log();
		}
	}
	
	private formatTime(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
		return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
	}
}

interface IngestionConfig {
	dryRun: boolean;
	verbose: boolean;
	quiet: boolean;
	concurrency: number;
	delayMs: number;
	maxFiles?: number;
	path: string;
	filter?: RegExp[];
	skipExisting: boolean;
	generateEmbeddings: boolean;
	chunkLargeDocuments: boolean;
	retryFailed: boolean;
	maxRetries: number;
	resume: boolean;
	exportResults: boolean;
	exportFormat: 'json' | 'csv' | 'txt';
	logToFile: boolean;
	stateFile: string;
	logFile: string;
	exportFile: string;
}

interface IngestionState {
	startTime: number;
	totalFiles: number;
	processedFiles: string[];
	failedFiles: { file: string; attempts: number; lastError: string }[];
	successfulFiles: string[];
	currentPhase: string;
	completed: boolean;
	lastSaved: number;
	config: Partial<IngestionConfig>;
}

interface DetailedStats {
	totalFiles: number;
	processedFiles: number;
	successfulFiles: number;
	failedFiles: number;
	skippedFiles: number;
	newDocuments: number;
	updatedDocuments: number;
	documentsWithEmbeddings: number;
	totalChunks: number;
	averageProcessingTime: number;
	totalProcessingTime: number;
	memoryUsage: {
		used: number;
		total: number;
		percentage: number;
	};
	errors: { file: string; error: string; attempts: number }[];
	filesByStatus: {
		pending: string[];
		processing: string[];
		completed: string[];
		failed: string[];
		skipped: string[];
	};
}

class EnhancedMarkdownIngestionService {
	private config: IngestionConfig;
	private state: IngestionState;
	private ingestionService: KnowledgeIngestionService;
	private embeddingService: any;
	private startTime: number = Date.now();
	private progressBar?: ProgressBar;

	constructor(config: IngestionConfig) {
		this.config = config;
		this.ingestionService = new KnowledgeIngestionService();
		this.state = this.loadState();
	}

	async run(): Promise<void> {
		try {
			await this.initialize();
			
			if (!this.config.quiet) {
				this.printBanner();
				await this.printPreIngestionStats();
			}

			if (this.config.dryRun) {
				await this.runDryRun();
				return;
			}

			await this.runIngestion();
			
			if (!this.config.quiet) {
				await this.printFinalResults();
			}
			
			if (this.config.exportResults) {
				await this.exportResults();
			}
			
		} catch (error) {
			this.handleError('Fatal error during ingestion', error);
			throw error;
		} finally {
			await this.cleanup();
		}
	}

	private async initialize(): Promise<void> {
		if (this.config.logToFile) {
			const logsDir = join(process.cwd(), 'logs');
			if (!existsSync(logsDir)) {
				mkdirSync(logsDir, { recursive: true });
			}
		}

		if (this.config.resume && existsSync(this.config.stateFile)) {
			this.state = this.loadState();
			this.log('info', `Resuming ingestion from ${this.state.processedFiles.length} processed files`);
		} else {
			this.state = this.createInitialState();
		}

		const { EmbeddingStorageService } = await import('../src/services/embedding-storage.service');
		this.embeddingService = EmbeddingStorageService.getInstance();
		
		try {
			await this.embeddingService.initialize();
		} catch (error) {
			this.log('warn', `Failed to initialize embedding service: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
		
		if (this.config.generateEmbeddings && !this.embeddingService.isEnabled()) {
			this.log('warn', 'Embedding service is not enabled - no embeddings will be generated');
			this.log('warn', 'Make sure LLM_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is set in your .env file');
			this.config.generateEmbeddings = false;
		} else if (this.config.generateEmbeddings && this.embeddingService.isEnabled()) {
			this.log('info', 'Embedding service initialized successfully - embeddings will be generated');
		}
	}

	private async runDryRun(): Promise<void> {
		this.log('info', '🏃‍♂️ Running in DRY RUN mode - no changes will be made');
		
		const files = await this.fetchMarkdownFiles();
		const filteredFiles = await this.filterFiles(files);
		
		console.log('\n📊 Dry Run Results:');
		console.log(`   Total markdown files found: ${files.length}`);
		console.log(`   Files after filtering: ${filteredFiles.length}`);
		
		if (this.config.maxFiles) {
			console.log(`   File limit: ${Math.min(filteredFiles.length, this.config.maxFiles)} files`);
		}
		
		if (this.config.skipExisting) {
			const existingCount = files.length - filteredFiles.length;
			console.log(`   Existing files that would be skipped: ${existingCount}`);
		}
		
		console.log('\n📋 Sample files that would be processed:');
		filteredFiles.slice(0, 10).forEach((file, i) => {
			console.log(`   ${i + 1}. ${file}`);
		});
		
		if (filteredFiles.length > 10) {
			console.log(`   ... and ${filteredFiles.length - 10} more files`);
		}
	}

	private async runIngestion(): Promise<void> {
		this.log('info', '🚀 Starting Markdown file ingestion...');
		this.state.startTime = Date.now();
		this.state.currentPhase = 'fetching_files';
		
		const files = await this.fetchMarkdownFiles();
		const filesToProcess = await this.filterFiles(files);
		
		this.state.totalFiles = filesToProcess.length;
		this.saveState();
		
		if (filesToProcess.length === 0) {
			this.log('warn', 'No files to process');
			return;
		}
		
		if (!this.config.quiet) {
			this.progressBar = new ProgressBar(filesToProcess.length, 50, true);
		}
		
		let processed = 0;
		const batchSize = this.config.concurrency;
		
		for (let i = 0; i < filesToProcess.length; i += batchSize) {
			const batch = filesToProcess.slice(i, i + batchSize);
			
			this.state.currentPhase = 'processing_batch';
			await this.processBatch(batch);
			
			processed += batch.length;
			this.progressBar?.update(processed, `Processed ${processed}/${filesToProcess.length} files`);
			
			if (Date.now() - this.state.lastSaved > 30000) {
				this.saveState();
			}
			
			if (processed % 50 === 0) {
				this.performMemoryCleanup();
			}
			
			if (i + batchSize < filesToProcess.length && this.config.delayMs > 0) {
				await this.sleep(this.config.delayMs);
			}
		}
		
		if (this.config.retryFailed && this.state.failedFiles.length > 0) {
			await this.retryFailedFiles();
		}
		
		this.state.completed = true;
		this.state.currentPhase = 'completed';
		this.saveState();
	}

	private async processBatch(files: string[]): Promise<void> {
		const promises = files.map(async (file) => {
			try {
				if (this.state.processedFiles.includes(file)) {
					return { file, success: true, skipped: true };
				}
				
				const content = await this.parseMarkdownFile(file);
				
				await this.storeDocument(content, {
					generateEmbeddings: this.config.generateEmbeddings,
					chunkLargeDocuments: this.config.chunkLargeDocuments,
					sourceType: 'markdown',
					sourceDomain: 'local'
				});
				
				this.state.processedFiles.push(file);
				this.state.successfulFiles.push(file);
				
				return { file, success: true };
			} catch (error) {
				// Handle unique constraint errors specifically
				if (error instanceof Error && error.message.includes('Unique constraint failed on the fields: (`url`)')) {
					this.log('warn', `Document already exists for ${file}, skipping...`);
					this.state.processedFiles.push(file);
					// Don't add to successfulFiles since we didn't actually process it
					return { file, success: true, skipped: true };
				}
				
				this.handleFileError(file, error);
				return { file, success: false, error: error instanceof Error ? error.message : 'Unknown error' };
			}
		});
		
		await Promise.allSettled(promises);
	}

	private async retryFailedFiles(): Promise<void> {
		const filesToRetry = this.state.failedFiles
			.filter(f => f.attempts < this.config.maxRetries)
			.map(f => f.file);
		
		if (filesToRetry.length === 0) return;
		
		this.log('info', `🔄 Retrying ${filesToRetry.length} failed files...`);
		
		if (!this.config.quiet) {
			this.progressBar = new ProgressBar(filesToRetry.length, 30, true);
		}
		
		for (let i = 0; i < filesToRetry.length; i++) {
			const file = filesToRetry[i];
			
			try {
				await this.processBatch([file]);
				
				this.state.failedFiles = this.state.failedFiles.filter(f => f.file !== file);
			} catch (error) {
				const failedItem = this.state.failedFiles.find(f => f.file === file);
				if (failedItem) {
					failedItem.attempts++;
					failedItem.lastError = error instanceof Error ? error.message : 'Unknown error';
				}
			}
			
			this.progressBar?.update(i + 1, `Retrying ${i + 1}/${filesToRetry.length} failed files`);
			
			if (this.config.delayMs > 0) {
				await this.sleep(this.config.delayMs * 2);
			}
		}
	}

	private async fetchMarkdownFiles(): Promise<string[]> {
		this.log('info', '📁 Fetching markdown files...');
		
		try {
			const pattern = '**/*.md';
			const glob = new Glob(pattern);
			const files: string[] = [];
			
			for await (const file of glob.scan({
				cwd: this.config.path,
				onlyFiles: true,
				dot: false
			})) {
				const normalizedFile = file.replace(/\\/g, '/');
				if (!normalizedFile.includes('node_modules/') && 
					!normalizedFile.includes('.git/') && 
					!normalizedFile.includes('dist/') && 
					!normalizedFile.includes('build/')) {
					files.push(join(this.config.path, normalizedFile));
				}
			}
			
			this.log('info', `Found ${files.length} markdown files`);
			return files;
		} catch (error) {
			this.handleError('Failed to fetch markdown files', error);
			throw error;
		}
	}

	private async filterFiles(files: string[]): Promise<string[]> {
		let filtered = [...files];
		
		if (this.config.filter && this.config.filter.length > 0) {
			filtered = filtered.filter(file => 
				this.config.filter!.some(pattern => pattern.test(file))
			);
		}
		
		if (this.config.skipExisting) {
			const existingFiles = await this.getExistingFiles(filtered);
			filtered = filtered.filter(file => !existingFiles.has(file));
		}
		
		if (this.config.maxFiles) {
			filtered = filtered.slice(0, this.config.maxFiles);
		}
		
		return filtered;
	}

	private async getExistingFiles(files: string[]): Promise<Set<string>> {
		try {
			const { PrismaClient } = await import('@prisma/client');
			const prisma = new PrismaClient();
			
			// Create URLs in the same format as parseMarkdownFile
			const fileUrls = files.map(file => `file://${file}`);
			
			const existing = await prisma.knowledgeDocument.findMany({
				where: { 
					url: {
						in: fileUrls
					},
					parentId: null 
				},
				select: { 
					url: true,
					metadata: true
				}
			});
			
			await prisma.$disconnect();
			
			// Map URLs back to file paths
			const existingFiles = new Set<string>();
			existing.forEach(doc => {
				if (doc.url?.startsWith('file://')) {
					const filePath = doc.url.substring(7); // Remove 'file://' prefix
					existingFiles.add(filePath);
				}
			});
			
			this.log('info', `Found ${existingFiles.size} existing files to skip`);
			return existingFiles;
		} catch (error) {
			this.log('warn', `Failed to check existing files: ${error instanceof Error ? error.message : 'Unknown error'}`);
			this.log('warn', 'Proceeding without skip - may encounter duplicate errors');
			return new Set();
		}
	}

	private async parseMarkdownFile(filePath: string): Promise<any> {
		const content = readFileSync(filePath, 'utf8');
		const fileName = basename(filePath, extname(filePath));
		const stats = await import('fs').then(fs => fs.promises.stat(filePath));
		
		let frontMatter: any = {};
		let markdownContent = content;
		
		if (content.startsWith('---\n')) {
			const endIndex = content.indexOf('\n---\n', 4);
			if (endIndex !== -1) {
				const frontMatterText = content.slice(4, endIndex);
				markdownContent = content.slice(endIndex + 5);
				
				try {
					const yaml = await import('yaml');
					frontMatter = yaml.parse(frontMatterText);
				} catch (error) {
					this.log('warn', `Failed to parse frontmatter in ${filePath}: ${error}`);
				}
			}
		}
		
		const title = frontMatter.title || fileName;
		const summary = frontMatter.description || frontMatter.summary || this.extractSummary(markdownContent);
		
		return {
			title,
			url: `file://${filePath}`,
			content: markdownContent,
			summary,
			metadata: {
				filePath,
				fileName,
				language: frontMatter.lang || frontMatter.language || 'en',
				author: frontMatter.author,
				date: frontMatter.date,
				tags: frontMatter.tags || [],
				category: frontMatter.category,
				fileSize: stats.size,
				modifiedTime: stats.mtime,
				createdTime: stats.ctime,
				...frontMatter
			}
		};
	}

	private extractSummary(content: string): string {
		const firstParagraph = content.split('\n\n')[0];
		const cleaned = firstParagraph.replace(/[#*`]/g, '').trim();
		return cleaned.length > 200 ? cleaned.substring(0, 197) + '...' : cleaned;
	}

	private printBanner(): void {
		console.log('\n' + '='.repeat(70));
		console.log('🚀 Enhanced Markdown File Ingestion Tool');
		console.log('='.repeat(70));
		console.log(`📅 Started: ${new Date().toLocaleString()}`);
		console.log(`⚙️  Configuration:`);
		console.log(`   • Path: ${this.config.path}`);
		console.log(`   • Concurrency: ${this.config.concurrency}`);
		console.log(`   • Delay: ${this.config.delayMs}ms`);
		console.log(`   • Generate Embeddings: ${this.config.generateEmbeddings ? '✅' : '❌'}`);
		console.log(`   • Chunk Documents: ${this.config.chunkLargeDocuments ? '✅' : '❌'}`);
		console.log(`   • Skip Existing: ${this.config.skipExisting ? '✅' : '❌'}`);
		console.log(`   • Max Files: ${this.config.maxFiles || 'No limit'}`);
		console.log(`   • Retry Failed: ${this.config.retryFailed ? '✅' : '❌'}`);
		console.log(`   • Max Retries: ${this.config.maxRetries}`);
		console.log('='.repeat(70) + '\n');
	}

	private async printPreIngestionStats(): Promise<void> {
		try {
			const stats = await this.ingestionService.getIngestionStats();
			
			console.log('📊 Current Knowledge Base Statistics:');
			console.log(`   • Total Documents: ${stats.totalDocuments.toLocaleString()}`);
			console.log(`   • Total Chunks: ${stats.totalChunks.toLocaleString()}`);
			console.log(`   • Documents with Embeddings: ${stats.documentsWithEmbeddings.toLocaleString()}`);
			console.log(`   • Last Ingestion: ${stats.lastIngestionDate ? stats.lastIngestionDate.toLocaleString() : 'Never'}`);
			
			if (stats.documentsBySource.length > 0) {
				console.log('\n📚 Documents by Source:');
				stats.documentsBySource.forEach(source => {
					console.log(`   • ${source.source}: ${source.count.toLocaleString()} documents`);
				});
			}
			
			console.log('');
		} catch (error) {
			this.log('warn', 'Could not fetch pre-ingestion statistics');
		}
	}

	private async printFinalResults(): Promise<void> {
		const duration = Date.now() - this.startTime;
		const stats = await this.calculateDetailedStats();
		
		console.log('\n' + '='.repeat(70));
		console.log('🎉 Ingestion Results');
		console.log('='.repeat(70));
		
		console.log(`⏱️  Duration: ${this.formatDuration(duration)}`);
		console.log(`📄 Files Processed: ${stats.processedFiles.toLocaleString()}`);
		console.log(`✅ Successful: ${stats.successfulFiles.toLocaleString()}`);
		console.log(`❌ Failed: ${stats.failedFiles.toLocaleString()}`);
		console.log(`⏭️  Skipped: ${stats.skippedFiles.toLocaleString()}`);
		
		console.log(`📈 Average Processing Time: ${stats.averageProcessingTime.toFixed(2)}s per file`);
		console.log(`💾 Memory Usage: ${stats.memoryUsage.percentage.toFixed(1)}% (${this.formatBytes(stats.memoryUsage.used)}/${this.formatBytes(stats.memoryUsage.total)})`);
		
		console.log(`📝 New Documents Created: ${stats.newDocuments.toLocaleString()}`);
		console.log(`🧠 Documents with Embeddings: ${stats.documentsWithEmbeddings.toLocaleString()}`);
		console.log(`📑 Total Chunks Created: ${stats.totalChunks.toLocaleString()}`);
		
		if (stats.errors.length > 0) {
			console.log(`\n❌ Errors (showing first 10):`);
			stats.errors.slice(0, 10).forEach((error, i) => {
				console.log(`   ${i + 1}. ${error.file.substring(0, 60)}${error.file.length > 60 ? '...' : ''}`);
				console.log(`      Error: ${error.error} (${error.attempts} attempts)`);
			});
			
			if (stats.errors.length > 10) {
				console.log(`   ... and ${stats.errors.length - 10} more errors`);
			}
		}
		
		console.log('='.repeat(70) + '\n');
	}

	private async exportResults(): Promise<void> {
		const stats = await this.calculateDetailedStats();
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const filename = this.config.exportFile.replace('{{timestamp}}', timestamp);
		
		try {
			let content = '';
			
			switch (this.config.exportFormat) {
				case 'json':
					content = JSON.stringify(stats, null, 2);
					break;
				case 'csv':
					content = this.generateCSVReport(stats);
					break;
				case 'txt':
					content = this.generateTextReport(stats);
					break;
			}
			
			writeFileSync(filename, content, 'utf8');
			this.log('info', `Results exported to: ${filename}`);
		} catch (error) {
			this.log('error', `Failed to export results: ${error}`);
		}
	}

	private generateCSVReport(stats: DetailedStats): string {
		const lines = [
			'File,Status,Attempts,Error',
			...stats.filesByStatus.completed.map(file => `"${file}",completed,1,`),
			...stats.errors.map(error => `"${error.file}",failed,${error.attempts},"${error.error.replace(/"/g, '""')}"`),
			...stats.filesByStatus.skipped.map(file => `"${file}",skipped,0,`),
		];
		return lines.join('\n');
	}

	private generateTextReport(stats: DetailedStats): string {
		return `
Markdown File Ingestion Report
Generated: ${new Date().toLocaleString()}

SUMMARY
=======
Total Files: ${stats.totalFiles}
Processed: ${stats.processedFiles}
Successful: ${stats.successfulFiles}
Failed: ${stats.failedFiles}
Skipped: ${stats.skippedFiles}

PERFORMANCE
===========
Total Processing Time: ${this.formatDuration(stats.totalProcessingTime)}
Average Time per File: ${stats.averageProcessingTime.toFixed(2)}s
Memory Usage: ${stats.memoryUsage.percentage.toFixed(1)}%

DOCUMENTS
=========
New Documents: ${stats.newDocuments}
Documents with Embeddings: ${stats.documentsWithEmbeddings}
Total Chunks: ${stats.totalChunks}

ERRORS
======
${stats.errors.map(e => `${e.file}: ${e.error} (${e.attempts} attempts)`).join('\n')}
`.trim();
	}

	private async calculateDetailedStats(): Promise<DetailedStats> {
		const memoryUsage = process.memoryUsage();
		
		return {
			totalFiles: this.state.totalFiles,
			processedFiles: this.state.processedFiles.length,
			successfulFiles: this.state.successfulFiles.length,
			failedFiles: this.state.failedFiles.length,
			skippedFiles: 0,
			newDocuments: this.state.successfulFiles.length,
			updatedDocuments: 0,
			documentsWithEmbeddings: this.config.generateEmbeddings ? this.state.successfulFiles.length : 0,
			totalChunks: 0,
			averageProcessingTime: this.state.processedFiles.length > 0 ? 
				(Date.now() - this.state.startTime) / 1000 / this.state.processedFiles.length : 0,
			totalProcessingTime: Date.now() - this.state.startTime,
			memoryUsage: {
				used: memoryUsage.heapUsed,
				total: memoryUsage.heapTotal,
				percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
			},
			errors: this.state.failedFiles,
			filesByStatus: {
				pending: [],
				processing: [],
				completed: this.state.successfulFiles,
				failed: this.state.failedFiles.map(f => f.file),
				skipped: []
			}
		};
	}

	private createInitialState(): IngestionState {
		return {
			startTime: Date.now(),
			totalFiles: 0,
			processedFiles: [],
			failedFiles: [],
			successfulFiles: [],
			currentPhase: 'initializing',
			completed: false,
			lastSaved: Date.now(),
			config: { ...this.config }
		};
	}

	private loadState(): IngestionState {
		try {
			if (existsSync(this.config.stateFile)) {
				const data = readFileSync(this.config.stateFile, 'utf8');
				return JSON.parse(data);
			}
		} catch (error) {
			this.log('warn', 'Failed to load state file, creating new state');
		}
		return this.createInitialState();
	}

	private saveState(): void {
		try {
			this.state.lastSaved = Date.now();
			writeFileSync(this.config.stateFile, JSON.stringify(this.state, null, 2));
		} catch (error) {
			this.log('error', `Failed to save state: ${error}`);
		}
	}

	private async storeDocument(
		content: any,
		options: {
			generateEmbeddings?: boolean;
			chunkLargeDocuments?: boolean;
			sourceType?: string;
			sourceDomain?: string;
		} = {}
	): Promise<string[]> {
		const {
			generateEmbeddings = true,
			chunkLargeDocuments = true,
			sourceType = 'markdown',
			sourceDomain = 'local'
		} = options;

		const { PrismaClient } = await import('@prisma/client');
		const prisma = new PrismaClient();
		
		try {
			const shouldChunk = chunkLargeDocuments && content.content.length > 3000;
			const documentIds: string[] = [];

			if (shouldChunk) {
				const { ContentFetcherService } = await import('../src/services/content-fetcher.service');
				const contentFetcher = new ContentFetcherService();
				const chunks = contentFetcher.chunkContent(content.content);

				const parentDocument = await prisma.knowledgeDocument.create({
					data: {
						title: content.title,
						url: content.url,
						source: sourceDomain,
						sourceType: sourceType,
						content: content.content,
						summary: content.summary,
						metadata: content.metadata,
						language: content.metadata.language || 'en',
						totalChunks: chunks.length,
					},
				});

				documentIds.push(parentDocument.id);

				for (const chunk of chunks) {
					let embedding: number[] | undefined;

					if (generateEmbeddings && this.embeddingService.isEnabled()) {
						try {
							console.log(`  🧠 Generating embedding for chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks}...`);
							embedding = await this.embeddingService.generateEmbedding(chunk.content, "document");
							if (embedding) {
								console.log(`  ✅ Embedding generated (${embedding.length} dimensions)`);
							}
						} catch (error) {
							console.error("  ❌ Failed to generate embedding for chunk:", error);
						}
					}

					const chunkDoc = await prisma.knowledgeDocument.create({
						data: {
							title: `${content.title} (Part ${chunk.chunkIndex + 1})`,
							url: content.url,
							source: sourceDomain,
							sourceType: sourceType,
							content: chunk.content,
							embedding: embedding,
							model: embedding ? this.getEmbeddingModel() : undefined,
							dimensions: embedding?.length,
							parentId: parentDocument.id,
							chunkIndex: chunk.chunkIndex,
							chunkSize: chunk.chunkSize,
							totalChunks: chunk.totalChunks,
							language: content.metadata.language || 'en',
							metadata: {
								...content.metadata,
								isChunk: true,
								parentTitle: content.title,
							},
						},
					});

					documentIds.push(chunkDoc.id);
				}
			} else {
				let embedding: number[] | undefined;

				if (generateEmbeddings && this.embeddingService.isEnabled()) {
					try {
						console.log(`  🧠 Generating embedding for document...`);
						embedding = await this.embeddingService.generateEmbedding(content.content, "document");
						if (embedding) {
							console.log(`  ✅ Embedding generated (${embedding.length} dimensions)`);
						}
					} catch (error) {
						console.error("  ❌ Failed to generate embedding:", error);
					}
				}

				const document = await prisma.knowledgeDocument.create({
					data: {
						title: content.title,
						url: content.url,
						source: sourceDomain,
						sourceType: sourceType,
						content: content.content,
						embedding: embedding,
						model: embedding ? this.getEmbeddingModel() : undefined,
						dimensions: embedding?.length,
						summary: content.summary,
						metadata: content.metadata,
						language: content.metadata.language || 'en',
					},
				});

				documentIds.push(document.id);
			}

			return documentIds;
		} finally {
			await prisma.$disconnect();
		}
	}

	private getEmbeddingModel(): string {
		const provider = process.env.LLM_PROVIDER || "openai";
		switch (provider) {
			case "google":
				return "gemini-embedding-001";
			case "openai":
			default:
				return "text-embedding-ada-002";
		}
	}

	private handleFileError(file: string, error: unknown): void {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		
		let failedItem = this.state.failedFiles.find(f => f.file === file);
		if (failedItem) {
			failedItem.attempts++;
			failedItem.lastError = errorMessage;
		} else {
			this.state.failedFiles.push({ file, attempts: 1, lastError: errorMessage });
		}
		
		this.log('error', `Failed to process ${file}: ${errorMessage}`);
	}

	private handleError(message: string, error: unknown): void {
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';
		this.log('error', `${message}: ${errorMsg}`);
	}

	private log(level: 'info' | 'warn' | 'error', message: string): void {
		if (this.config.quiet && level !== 'error') return;
		
		const timestamp = new Date().toISOString();
		const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
		
		console.log(logMessage);
		
		if (this.config.logToFile) {
			try {
				writeFileSync(this.config.logFile, logMessage + '\n', { flag: 'a' });
			} catch (error) {
				// Silent fail for logging
			}
		}
	}

	private formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
		
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
	}

	private formatBytes(bytes: number): string {
		const sizes = ['B', 'KB', 'MB', 'GB'];
		if (bytes === 0) return '0 B';
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private performMemoryCleanup(): void {
		if (global.gc) {
			global.gc();
		}
	}

	private async cleanup(): Promise<void> {
		this.saveState();
		await this.ingestionService.disconnect();
		await this.embeddingService?.shutdown();
	}
}

function parseArguments(): IngestionConfig {
	const args = process.argv.slice(2);
	const config: IngestionConfig = {
		dryRun: false,
		verbose: false,
		quiet: false,
		concurrency: 3,
		delayMs: 1000,
		path: process.cwd(),
		skipExisting: true,
		generateEmbeddings: true,
		chunkLargeDocuments: true,
		retryFailed: true,
		maxRetries: 3,
		resume: false,
		exportResults: false,
		exportFormat: 'json',
		logToFile: true,
		stateFile: join(process.cwd(), 'markdown-ingestion-state.json'),
		logFile: join(process.cwd(), 'logs', `markdown-ingestion-${new Date().toISOString().slice(0, 10)}.log`),
		exportFile: join(process.cwd(), 'markdown-ingestion-results-{{timestamp}}.json')
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		
		switch (arg) {
			case '--dry-run':
				config.dryRun = true;
				break;
			case '--verbose':
				config.verbose = true;
				break;
			case '--quiet':
				config.quiet = true;
				break;
			case '--no-embeddings':
				config.generateEmbeddings = false;
				break;
			case '--no-chunks':
				config.chunkLargeDocuments = false;
				break;
			case '--no-skip-existing':
				config.skipExisting = false;
				break;
			case '--no-retry':
				config.retryFailed = false;
				break;
			case '--resume':
				config.resume = true;
				break;
			case '--export':
				config.exportResults = true;
				break;
			case '--export-csv':
				config.exportResults = true;
				config.exportFormat = 'csv';
				config.exportFile = config.exportFile.replace('.json', '.csv');
				break;
			case '--export-txt':
				config.exportResults = true;
				config.exportFormat = 'txt';
				config.exportFile = config.exportFile.replace('.json', '.txt');
				break;
			case '--path':
				config.path = args[++i];
				break;
			case '--concurrency':
				config.concurrency = parseInt(args[++i]) || 3;
				break;
			case '--delay':
				config.delayMs = parseInt(args[++i]) || 1000;
				break;
			case '--max-files':
				config.maxFiles = parseInt(args[++i]);
				break;
			case '--max-retries':
				config.maxRetries = parseInt(args[++i]) || 3;
				break;
			case '--filter':
				const pattern = args[++i];
				config.filter = config.filter || [];
				config.filter.push(new RegExp(pattern, 'i'));
				break;
			case '--state-file':
				config.stateFile = args[++i];
				break;
			case '--log-file':
				config.logFile = args[++i];
				break;
			case '--export-file':
				config.exportFile = args[++i];
				break;
			case '--help':
			case '-h':
				printHelp();
				process.exit(0);
				break;
			default:
				if (arg.startsWith('--')) {
					console.error(`Unknown option: ${arg}`);
					console.error('Use --help for usage information');
					process.exit(1);
				}
				break;
		}
	}

	return config;
}

function printHelp(): void {
	console.log(`
🚀 Enhanced Markdown File Ingestion Tool

USAGE:
  bun scripts/ingest-markdown.ts [OPTIONS]

OPTIONS:
  --dry-run                     Preview what would be ingested without making changes
  --verbose                     Enable verbose logging
  --quiet                       Minimal output (errors only)
  --resume                      Resume from previous ingestion state
  
  Content Options:
  --no-embeddings              Don't generate embeddings
  --no-chunks                  Don't chunk large documents  
  --no-skip-existing           Process all files (don't skip existing)
  --no-retry                   Don't retry failed files
  
  Performance Options:
  --concurrency <num>          Number of concurrent requests (default: 3)
  --delay <ms>                 Delay between batches in milliseconds (default: 1000)
  --max-retries <num>          Maximum retry attempts for failed files (default: 3)
  
  Path Options:
  --path <path>                Path to scan for markdown files (default: current directory)
  --max-files <num>            Limit number of files to process
  --filter <pattern>           Only process files matching regex pattern (can use multiple times)
  
  Export Options:
  --export                     Export results as JSON
  --export-csv                 Export results as CSV
  --export-txt                 Export results as text report
  --export-file <path>         Custom export file path (use {{timestamp}} for timestamp)
  
  State Management:
  --state-file <path>          Custom state file path
  --log-file <path>            Custom log file path
  
  --help, -h                   Show this help message

EXAMPLES:
  # Basic ingestion from current directory
  bun scripts/ingest-markdown.ts
  
  # Dry run to see what would be processed
  bun scripts/ingest-markdown.ts --dry-run
  
  # Process files from specific directory
  bun scripts/ingest-markdown.ts --path ./docs --concurrency 5
  
  # Resume previous ingestion and export results
  bun scripts/ingest-markdown.ts --resume --export-csv
  
  # Process specific file patterns only
  bun scripts/ingest-markdown.ts --filter "README" --filter "guide" --max-files 20
`);
}

async function main(): Promise<void> {
	try {
		const config = parseArguments();
		const service = new EnhancedMarkdownIngestionService(config);
		await service.run();
	} catch (error) {
		console.error('❌ Fatal error:', error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

process.on('SIGINT', () => {
	console.log('\n⏹️  Ingestion interrupted. State has been saved.');
	console.log('   Use --resume to continue from where you left off.');
	process.exit(0);
});

process.on('SIGTERM', () => {
	console.log('\n⏹️  Ingestion terminated. State has been saved.');
	process.exit(0);
});

main().catch(console.error);