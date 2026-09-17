import type { AnySandbox } from "@/types";

export interface BackgroundProcess {
  pid: number;
  command: string;
  outputFiles: string[];
  startTime: number;
}

export class BackgroundProcessTracker {
  private processes: Map<number, BackgroundProcess>;

  constructor() {
    this.processes = new Map();
  }

  /**
   * Add a background process to track
   */
  addProcess(pid: number, command: string, outputFiles: string[]): void {
    this.processes.set(pid, {
      pid,
      command,
      outputFiles,
      startTime: Date.now(),
    });
  }

  /**
   * Remove a completed process from tracking
   */
  removeProcess(pid: number): void {
    this.processes.delete(pid);
  }

  /**
   * Check if a process is still running
   */
  async checkProcessStatus(sandbox: AnySandbox, pid: number): Promise<boolean> {
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error("Invalid process identifier");
    let result: { exitCode?: number | null; stdout: string; stderr: string };
    try {
      result = await sandbox.commands.run(`ps -p ${pid} -o pid=`, {});
    } catch (error) {
      // A transport failure is not a negative process lookup. E2B throws
      // nonzero command exits, so only its explicit exit receipt is inspected.
      if (!(error instanceof Error) || error.name !== "CommandExitError")
        throw error;
      // Keep the SDK out of module initialization; this tracker is also used
      // by local tools and only cloud exit receipts need the SDK class.
      const { CommandExitError } = await import("@e2b/code-interpreter");
      if (!(error instanceof CommandExitError)) throw error;
      result = error;
    }
    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    if (result.exitCode === 0 && stdout === String(pid) && stderr === "")
      return true;
    if (result.exitCode === 1 && stdout === "" && stderr === "") {
      this.removeProcess(pid);
      return false;
    }
    throw new Error("Background process status is unconfirmed");
  }

  /**
   * Check if any tracked processes are writing to the requested files
   * Inspects only processes associated with the requested files
   */
  async hasActiveProcessesForFiles(
    sandbox: AnySandbox,
    filePaths: string[],
  ): Promise<{ active: boolean; processes: BackgroundProcess[] }> {
    const activeProcesses: BackgroundProcess[] = [];

    // Unrelated background work must not gate this file's availability.
    for (const [pid, process] of this.processes.entries()) {
      const hasMatchingFile = process.outputFiles.some((outputFile) =>
        filePaths.some((requestedFile) => {
          const normalizedOutput = this.normalizePath(outputFile);
          const normalizedRequested = this.normalizePath(requestedFile);
          return (
            normalizedOutput === normalizedRequested ||
            normalizedOutput.endsWith("/" + normalizedRequested) ||
            normalizedRequested.endsWith("/" + normalizedOutput)
          );
        }),
      );
      if (hasMatchingFile && (await this.checkProcessStatus(sandbox, pid)))
        activeProcesses.push(process);
    }

    return {
      active: activeProcesses.length > 0,
      processes: activeProcesses,
    };
  }

  /**
   * Normalize file path for comparison
   */
  private normalizePath(path: string): string {
    // Remove leading/trailing spaces and normalize slashes
    let normalized = path.trim().replace(/\/+/g, "/");

    // Remove leading ./ if present
    if (normalized.startsWith("./")) {
      normalized = normalized.slice(2);
    }

    return normalized;
  }

  /**
   * Extract output file paths from a command string
   */
  static extractOutputFiles(command: string): string[] {
    const outputFiles: string[] = [];

    // Pattern 1: nmap -oN file, -oX file, -oG file
    const nmapPatterns = [
      /-oN\s+([^\s]+)/g,
      /-oX\s+([^\s]+)/g,
      /-oG\s+([^\s]+)/g,
    ];

    for (const pattern of nmapPatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        const filename = match[1].replace(/^['"]|['"]$/g, "");
        outputFiles.push(filename);
      }
    }

    // Pattern 2: nmap -oA prefix (creates prefix.nmap, prefix.xml, prefix.gnmap)
    const nmapAllPattern = /-oA\s+([^\s]+)/g;
    let match;
    while ((match = nmapAllPattern.exec(command)) !== null) {
      const prefix = match[1];
      outputFiles.push(`${prefix}.nmap`, `${prefix}.xml`, `${prefix}.gnmap`);
    }

    // Pattern 3: Shell redirection > file or >> file
    const redirectPattern = /(?:^|[|;&])\s*[^|;&]*?\s+>>?\s+([^\s|;&]+)/g;
    while ((match = redirectPattern.exec(command)) !== null) {
      const filename = match[1].replace(/^['"]|['"]$/g, "");
      outputFiles.push(filename);
    }

    // Pattern 4: tee file
    const teePattern = /\|\s*tee\s+([^\s|;&]+)/g;
    while ((match = teePattern.exec(command)) !== null) {
      const filename = match[1].replace(/^['"]|['"]$/g, "");
      outputFiles.push(filename);
    }

    // Pattern 5: Generic --output file or -o file
    const genericPatterns = [/--output\s+([^\s]+)/g, /(?:^|\s)-o\s+([^\s]+)/g];

    for (const pattern of genericPatterns) {
      while ((match = pattern.exec(command)) !== null) {
        const filename = match[1].replace(/^['"]|['"]$/g, "");
        outputFiles.push(filename);
      }
    }

    return [...new Set(outputFiles)];
  }

  /**
   * Get all tracked processes (for debugging)
   */
  getTrackedProcesses(): BackgroundProcess[] {
    return Array.from(this.processes.values());
  }

  /**
   * Clear all tracked processes
   */
  clear(): void {
    this.processes.clear();
  }
}
