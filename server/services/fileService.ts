import { containerService } from './containerService.js';
import path from 'path';
import { logger } from '../lib/logger.js';

const BASE_PATH = '/home/stone';

export class FileService {
  private validatePath(userId: string, targetPath: string): string {
    // Resolve path to prevent directory traversal
    const resolvedPath = path.posix.resolve(BASE_PATH, targetPath);
    
    // Ensure it starts with /home/stone/
    if (!resolvedPath.startsWith(BASE_PATH)) {
      throw new Error('Access denied: Path outside home directory');
    }
    
    // Block access to system directories
    const blockedPrefixes = ['/proc', '/sys', '/dev', '/etc'];
    if (blockedPrefixes.some(prefix => resolvedPath.startsWith(prefix))) {
      throw new Error('Access denied: System directory');
    }
    
    return resolvedPath;
  }

  private getIcon(filename: string, isDir: boolean): string {
    if (isDir) return '📁';
    const ext = path.posix.extname(filename).toLowerCase();
    switch (ext) {
      case '.py': return '🐍';
      case '.js': case '.ts': case '.jsx': case '.tsx': return '📦';
      case '.html': case '.css': case '.scss': return '🎨';
      case '.png': case '.jpg': case '.jpeg': case '.gif': case '.svg': case '.webp': return '🖼️';
      case '.json': return '📋';
      case '.md': case '.txt': return '📝';
      case '.pdf': return '📄';
      case '.zip': case '.tar': case '.gz': case '.rar': return '🗜️';
      case '.mp4': case '.avi': case '.mov': return '🎥';
      case '.mp3': case '.wav': case '.ogg': return '🎵';
      case '.sh': case '.bash': return '🐚';
      case '.csv': case '.xlsx': return '📊';
      default: return '📄';
    }
  }

  private getMimeType(filename: string): string {
    const ext = path.posix.extname(filename).toLowerCase();
    switch (ext) {
      case '.py': return 'text/x-python';
      case '.js': return 'application/javascript';
      case '.ts': return 'application/typescript';
      case '.html': return 'text/html';
      case '.css': return 'text/css';
      case '.png': return 'image/png';
      case '.jpg': case '.jpeg': return 'image/jpeg';
      case '.gif': return 'image/gif';
      case '.svg': return 'image/svg+xml';
      case '.json': return 'application/json';
      case '.md': return 'text/markdown';
      case '.txt': return 'text/plain';
      case '.pdf': return 'application/pdf';
      case '.zip': return 'application/zip';
      case '.mp4': return 'video/mp4';
      case '.mp3': return 'audio/mpeg';
      case '.csv': return 'text/csv';
      default: return 'application/octet-stream';
    }
  }

  async listFiles(userId: string, targetPath: string = BASE_PATH) {
    const validPath = this.validatePath(userId, targetPath);
    
    // Use stat and ls to get file info
    // Format: type|size|modified|name
    // type: d for dir, - for file
    const cmd = `ls -la --time-style=+%s "${validPath}" | tail -n +2 | awk '{print substr($1,1,1) "|" $5 "|" $6 "|" $8}'`;
    const { stdout, exitCode, stderr } = await containerService.execInContainer(userId, cmd);
    
    if (exitCode !== 0) {
      throw new Error(`Failed to list directory: ${stderr}`);
    }

    const items = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [type, sizeStr, modifiedStr, name] = line.split('|');
      if (name === '.' || name === '..') return null;
      
      const isDir = type === 'd';
      const size = parseInt(sizeStr, 10) || 0;
      const modified = parseInt(modifiedStr, 10) * 1000 || 0;
      const extension = isDir ? '' : path.posix.extname(name);
      const isHidden = name.startsWith('.');
      
      return {
        name,
        type: isDir ? 'directory' : 'file',
        size,
        modified,
        extension,
        mimeType: isDir ? 'inode/directory' : this.getMimeType(name),
        icon: this.getIcon(name, isDir),
        isHidden
      };
    }).filter(Boolean);

    // Sort: directories first, then alphabetical
    items.sort((a, b) => {
      if (a!.type === 'directory' && b!.type === 'file') return -1;
      if (a!.type === 'file' && b!.type === 'directory') return 1;
      return a!.name.localeCompare(b!.name);
    });

    return { path: validPath, items };
  }

  async readFile(userId: string, targetPath: string) {
    const validPath = this.validatePath(userId, targetPath);
    
    // Check size and type
    const statCmd = `stat -c "%s" "${validPath}"`;
    const { stdout: sizeOut, exitCode: statExit } = await containerService.execInContainer(userId, statCmd);
    if (statExit !== 0) throw new Error('File not found');
    
    const size = parseInt(sizeOut.trim(), 10);
    
    // Check if binary using file command
    const { stdout: fileOut } = await containerService.execInContainer(userId, `file -b --mime-encoding "${validPath}"`);
    const isBinary = fileOut.trim() === 'binary';
    
    if (isBinary && size > 50 * 1024 * 1024) {
      throw new Error('Binary file too large (max 50MB)');
    }
    if (!isBinary && size > 5 * 1024 * 1024) {
      throw new Error('Text file too large (max 5MB)');
    }

    const mimeType = this.getMimeType(validPath);

    if (isBinary) {
      const { stdout, exitCode, stderr } = await containerService.execInContainer(userId, `base64 "${validPath}"`);
      if (exitCode !== 0) throw new Error(`Failed to read binary file: ${stderr}`);
      return { content: stdout.replace(/\\n/g, ''), encoding: 'base64', mimeType, size, isBinary: true };
    } else {
      const { stdout, exitCode, stderr } = await containerService.execInContainer(userId, `cat "${validPath}"`);
      if (exitCode !== 0) throw new Error(`Failed to read text file: ${stderr}`);
      return { content: stdout, encoding: 'utf8', mimeType, size, isBinary: false };
    }
  }

  async writeFile(userId: string, targetPath: string, content: string, encoding: 'utf8' | 'base64' = 'utf8', createDirs: boolean = false) {
    const validPath = this.validatePath(userId, targetPath);
    logger.info(`[FileService] User ${userId} writing to ${validPath}`);
    
    if (createDirs) {
      const dir = path.posix.dirname(validPath);
      await containerService.execInContainer(userId, `mkdir -p "${dir}"`);
    }

    if (encoding === 'base64') {
      // Write base64 to temp file, then decode
      const tmpPath = `/tmp/upload_${Date.now()}.b64`;
      // Split content into chunks if it's very large, but for now assume it fits in command line or use a different approach
      // A better approach for large files is to write in chunks, but we'll use a simple echo for now
      // Actually, passing huge base64 strings via command line can hit limits. Let's use a safer approach:
      // We can write it chunk by chunk or use a small python script.
      // For simplicity, we'll use python to decode base64 from a string passed via stdin
      const cmd = `python3 -c "import sys, base64; sys.stdout.buffer.write(base64.b64decode(sys.stdin.read()))" > "${validPath}"`;
      
      // We need to pass the content to stdin. Since execInContainer doesn't support stdin directly yet,
      // we'll write the base64 to a file first using chunked echo.
      const chunkSize = 32000;
      await containerService.execInContainer(userId, `> "${tmpPath}"`); // clear file
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        await containerService.execInContainer(userId, `echo -n "${chunk}" >> "${tmpPath}"`);
      }
      
      await containerService.execInContainer(userId, `base64 -d "${tmpPath}" > "${validPath}"`);
      await containerService.execInContainer(userId, `rm "${tmpPath}"`);
    } else {
      // Escape single quotes for bash
      const escapedContent = content.replace(/'/g, "'\\''");
      await containerService.execInContainer(userId, `cat << 'EOF' > "${validPath}"\n${content}\nEOF`);
    }

    const { stdout: sizeOut } = await containerService.execInContainer(userId, `stat -c "%s" "${validPath}"`);
    return { success: true, path: validPath, size: parseInt(sizeOut.trim(), 10) || 0 };
  }

  async mkdir(userId: string, targetPath: string) {
    const validPath = this.validatePath(userId, targetPath);
    logger.info(`[FileService] User ${userId} mkdir ${validPath}`);
    const { exitCode, stderr } = await containerService.execInContainer(userId, `mkdir -p "${validPath}"`);
    if (exitCode !== 0) throw new Error(`Failed to create directory: ${stderr}`);
    return { success: true, path: validPath };
  }

  async deleteFile(userId: string, targetPath: string, recursive: boolean = false) {
    const validPath = this.validatePath(userId, targetPath);
    if (validPath === BASE_PATH || validPath === `${BASE_PATH}/`) {
      throw new Error('Cannot delete home directory');
    }
    logger.info(`[FileService] User ${userId} deleting ${validPath}`);
    
    const flag = recursive ? '-rf' : '-f';
    const { exitCode, stderr } = await containerService.execInContainer(userId, `rm ${flag} "${validPath}"`);
    if (exitCode !== 0) throw new Error(`Failed to delete: ${stderr}`);
    return { success: true, deleted: validPath };
  }

  async moveFile(userId: string, fromPath: string, toPath: string) {
    const validFrom = this.validatePath(userId, fromPath);
    const validTo = this.validatePath(userId, toPath);
    logger.info(`[FileService] User ${userId} moving ${validFrom} to ${validTo}`);
    
    const { exitCode, stderr } = await containerService.execInContainer(userId, `mv "${validFrom}" "${validTo}"`);
    if (exitCode !== 0) throw new Error(`Failed to move: ${stderr}`);
    return { success: true, from: validFrom, to: validTo };
  }

  async copyFile(userId: string, fromPath: string, toPath: string) {
    const validFrom = this.validatePath(userId, fromPath);
    const validTo = this.validatePath(userId, toPath);
    logger.info(`[FileService] User ${userId} copying ${validFrom} to ${validTo}`);
    
    const { exitCode, stderr } = await containerService.execInContainer(userId, `cp -r "${validFrom}" "${validTo}"`);
    if (exitCode !== 0) throw new Error(`Failed to copy: ${stderr}`);
    return { success: true, from: validFrom, to: validTo };
  }

  async search(userId: string, query: string, targetPath: string = BASE_PATH, type: 'name' | 'content' = 'name') {
    const validPath = this.validatePath(userId, targetPath);
    
    let cmd = '';
    if (type === 'name') {
      // Escape query for find
      const safeQuery = query.replace(/"/g, '\\"');
      cmd = `find "${validPath}" -name "*${safeQuery}*" | head -n 100`;
    } else {
      // Escape query for grep
      const safeQuery = query.replace(/"/g, '\\"');
      cmd = `grep -r --include="*" -l "${safeQuery}" "${validPath}" | head -n 100`;
    }

    const { stdout, exitCode } = await containerService.execInContainer(userId, cmd);
    
    // grep returns 1 if no lines were selected, which is fine
    if (exitCode !== 0 && exitCode !== 1) {
      // Ignore errors, just return empty
    }

    const results = stdout.trim().split('\n').filter(Boolean).map(p => ({
      path: p,
      name: path.posix.basename(p),
      type
    }));

    return { results, total: results.length };
  }

  async getInfo(userId: string, targetPath: string) {
    const validPath = this.validatePath(userId, targetPath);
    
    const { stdout, exitCode, stderr } = await containerService.execInContainer(userId, `stat -c "%s|%A|%U|%W|%Y" "${validPath}"`);
    if (exitCode !== 0) throw new Error(`Failed to get info: ${stderr}`);
    
    const [sizeStr, permissions, owner, createdStr, modifiedStr] = stdout.trim().split('|');
    
    let lines = 0;
    let md5 = '';
    
    // Check if it's a file
    const { stdout: typeOut } = await containerService.execInContainer(userId, `stat -c "%F" "${validPath}"`);
    if (typeOut.trim() === 'regular file') {
      const { stdout: wcOut } = await containerService.execInContainer(userId, `wc -l < "${validPath}"`);
      lines = parseInt(wcOut.trim(), 10) || 0;
      
      const { stdout: md5Out } = await containerService.execInContainer(userId, `md5sum "${validPath}" | awk '{print $1}'`);
      md5 = md5Out.trim();
    }

    return {
      size: parseInt(sizeStr, 10) || 0,
      permissions,
      owner,
      created: parseInt(createdStr, 10) * 1000 || 0,
      modified: parseInt(modifiedStr, 10) * 1000 || 0,
      lines: lines > 0 ? lines : undefined,
      md5: md5 || undefined
    };
  }

  async zip(userId: string, paths: string[], outputPath: string) {
    const validOutputPath = this.validatePath(userId, outputPath);
    const validPaths = paths.map(p => this.validatePath(userId, p));
    
    // Use relative paths for zip to avoid absolute paths in archive
    const pathsArg = validPaths.map(p => `"${p}"`).join(' ');
    
    const { exitCode, stderr } = await containerService.execInContainer(userId, `zip -r "${validOutputPath}" ${pathsArg}`);
    if (exitCode !== 0) throw new Error(`Failed to zip: ${stderr}`);
    
    return { success: true, path: validOutputPath };
  }

  async unzip(userId: string, targetPath: string, outputDir: string) {
    const validPath = this.validatePath(userId, targetPath);
    const validOutputDir = this.validatePath(userId, outputDir);
    
    await containerService.execInContainer(userId, `mkdir -p "${validOutputDir}"`);
    const { exitCode, stderr } = await containerService.execInContainer(userId, `unzip -o "${validPath}" -d "${validOutputDir}"`);
    if (exitCode !== 0) throw new Error(`Failed to unzip: ${stderr}`);
    
    return { success: true, outputDir: validOutputDir };
  }
}

export const fileService = new FileService();
