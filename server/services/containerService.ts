import Docker from 'dockerode';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { notificationService } from './notificationService.js';
import stream from 'stream';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const IMAGE_NAME = 'stoneaio-base:latest'; // Assumes the image is built locally
const NETWORK_NAME = 'stone_net';

export class ContainerService {
  private getContainerName(userId: string) {
    return `stone_${userId}`;
  }

  private getVolumeName(userId: string) {
    return `stone_vol_${userId}`;
  }

  private async ensureNetwork() {
    try {
      const network = docker.getNetwork(NETWORK_NAME);
      await network.inspect();
    } catch (err: any) {
      if (err.statusCode === 404) {
        logger.info(`Creating network ${NETWORK_NAME}`);
        await docker.createNetwork({ Name: NETWORK_NAME, Driver: 'bridge' });
      } else {
        throw err;
      }
    }
  }

  private async getFreePort(): Promise<number> {
    const db = getDb();
    const usedPorts = db.prepare('SELECT container_port FROM users WHERE container_port IS NOT NULL').all() as { container_port: number }[];
    const usedSet = new Set(usedPorts.map(p => p.container_port));
    
    // 10000-60000 range
    for (let i = 0; i < 1000; i++) {
      const port = Math.floor(Math.random() * 50000) + 10000;
      if (!usedSet.has(port)) {
        return port;
      }
    }
    throw new Error('No free ports available');
  }

  async provisionContainer(userId: string, subdomain: string) {
    logger.info(`Provisioning container for user ${userId}`);
    await this.ensureNetwork();

    const containerName = this.getContainerName(userId);
    const volumeName = this.getVolumeName(userId);

    // Create volume
    try {
      await docker.createVolume({ Name: volumeName });
    } catch (err: any) {
      logger.warn(`Volume ${volumeName} might already exist: ${err.message}`);
    }

    const port = await this.getFreePort();

    // Create container
    const container = await docker.createContainer({
      Image: IMAGE_NAME,
      name: containerName,
      Tty: true,
      OpenStdin: true,
      HostConfig: {
        Memory: 1024 * 1024 * 1024, // 1GB
        NanoCpus: 1000000000, // 1 core
        RestartPolicy: { Name: 'unless-stopped' },
        ReadonlyRootfs: false,
        CapDrop: ['ALL'],
        CapAdd: ['NET_BIND_SERVICE'],
        Binds: [`${volumeName}:/home/stone`],
        NetworkMode: NETWORK_NAME,
        PortBindings: {
          '3000/tcp': [{ HostPort: port.toString() }]
        }
      },
      ExposedPorts: {
        '3000/tcp': {}
      }
    }) as Docker.Container;

    await container.start();

    // Poll until healthy
    let isHealthy = false;
    for (let i = 0; i < 10; i++) {
      try {
        const { exitCode } = await this.execInContainer(userId, 'echo ok', { timeout: 5000 });
        if (exitCode === 0) {
          isHealthy = true;
          break;
        }
      } catch (err) {
        // Ignore and retry
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!isHealthy) {
      throw new Error('Container failed to become healthy');
    }

    // Create home structure
    await this.execInContainer(userId, 'mkdir -p sites projects scripts documents backups .config');

    // Write .stonerc
    const stonerc = `export PS1="\\[\\033[36m\\]stone@${subdomain}\\[\\033[0m\\]:\\[\\033[33m\\]\\w\\[\\033[0m\\]\\$ "
export TERM=xterm-256color
alias ll='ls -la'
echo "Stone AIO Computer · stoneaio.com"
`;
    await this.writeFile(userId, '/home/stone/.stonerc', stonerc);
    await this.execInContainer(userId, 'echo "source ~/.stonerc" >> ~/.bashrc');

    // Save to DB
    const db = getDb();
    db.prepare('UPDATE users SET container_id = ?, container_port = ?, container_status = ? WHERE id = ?')
      .run(container.id, port, 'running', userId);

    // Emit notification
    await notificationService.emit(userId, {
      type: 'container:ready',
      title: 'Your Stone computer is ready',
      body: 'Your personal AI cloud computer has been provisioned and is now running.',
      severity: 'success'
    });

    return { containerId: container.id, port, status: 'running' };
  }

  async execInContainer(userId: string, command: string, options: { timeout?: number, user?: string, workdir?: string, env?: string[], stream?: boolean } = {}) {
    const { timeout = 30000, user = 'stone', workdir = '/home/stone', env = [] } = options;

    // Block dangerous patterns
    if (/\/rm\s+-rf\s+\/(?!home)/.test(command) || /:\(\)\{.*\}/.test(command) || /dd\s+if=\/dev\/zero/.test(command)) {
      throw new Error('Command blocked due to security policy');
    }

    const containerName = this.getContainerName(userId);
    const container = docker.getContainer(containerName);

    const exec = await container.exec({
      Cmd: ['/bin/bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      User: user,
      WorkingDir: workdir,
      Env: env
    });

    const execStream = await exec.start({ Detach: false, Tty: false });

    return new Promise<{ stdout: string, stderr: string, exitCode: number }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
        reject(new Error('Command timed out'));
      }, timeout);

      docker.modem.demuxStream(execStream, 
        new stream.Writable({
          write(chunk, enc, cb) { stdout += chunk.toString(); cb(); }
        }),
        new stream.Writable({
          write(chunk, enc, cb) { stderr += chunk.toString(); cb(); }
        })
      );

      execStream.on('end', async () => {
        clearTimeout(timeoutId);
        if (abortController.signal.aborted) return;
        
        const inspect = await exec.inspect();
        resolve({ stdout, stderr, exitCode: inspect.ExitCode || 0 });
      });

      execStream.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  async streamExec(userId: string, command: string, onData: (data: string) => void, onEnd: (exitCode: number) => void, onError: (err: Error) => void) {
    if (/\/rm\s+-rf\s+\/(?!home)/.test(command) || /:\(\)\{.*\}/.test(command) || /dd\s+if=\/dev\/zero/.test(command)) {
      throw new Error('Command blocked due to security policy');
    }

    const containerName = this.getContainerName(userId);
    const container = docker.getContainer(containerName);

    const exec = await container.exec({
      Cmd: ['/bin/bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      User: 'stone',
      WorkingDir: '/home/stone',
      Tty: true // Use TTY for streaming to get combined output
    });

    const execStream = await exec.start({ Detach: false, Tty: true });

    execStream.on('data', (chunk) => {
      onData(chunk.toString());
    });

    execStream.on('end', async () => {
      try {
        const inspect = await exec.inspect();
        onEnd(inspect.ExitCode || 0);
      } catch (err: any) {
        onError(err);
      }
    });

    execStream.on('error', onError);

    return () => {
      // No direct way to kill an exec session in dockerode easily without killing the container
      // but we can destroy the stream
      execStream.destroy();
    };
  }

  async writeFile(userId: string, path: string, content: string) {
    // Escape single quotes for bash
    const escapedContent = content.replace(/'/g, "'\\''");
    await this.execInContainer(userId, `cat << 'EOF' > ${path}\n${content}\nEOF`);
  }

  async readFile(userId: string, path: string) {
    const { stdout, exitCode, stderr } = await this.execInContainer(userId, `cat ${path}`);
    if (exitCode !== 0) {
      throw new Error(`Failed to read file: ${stderr}`);
    }
    return stdout;
  }

  async listDirectory(userId: string, path: string) {
    const { stdout, exitCode, stderr } = await this.execInContainer(userId, `ls -la ${path}`);
    if (exitCode !== 0) {
      throw new Error(`Failed to list directory: ${stderr}`);
    }
    return stdout;
  }

  async getStats(userId: string) {
    const containerName = this.getContainerName(userId);
    const container = docker.getContainer(containerName);
    
    try {
      const statsStream = await container.stats({ stream: false });
      const stats = statsStream as any;
      
      // Calculate CPU percent
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemCpuDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const numberCpus = stats.cpu_stats.online_cpus || 1;
      const cpuPercent = systemCpuDelta > 0 ? (cpuDelta / systemCpuDelta) * numberCpus * 100.0 : 0.0;

      // Memory
      const memoryUsage = stats.memory_stats.usage || 0;
      const memoryLimit = stats.memory_stats.limit || 0;
      const memoryMB = memoryUsage / (1024 * 1024);
      const memoryLimitMB = memoryLimit / (1024 * 1024);

      // Disk (rough estimate using du in container)
      const { stdout: diskOut } = await this.execInContainer(userId, 'du -sb /home/stone', { timeout: 5000 });
      const diskBytes = parseInt(diskOut.split('\t')[0], 10) || 0;
      const diskUsedGB = diskBytes / (1024 * 1024 * 1024);
      const diskLimitGB = 10; // Arbitrary limit for display

      return {
        cpuPercent: parseFloat(cpuPercent.toFixed(2)),
        memoryMB: parseFloat(memoryMB.toFixed(2)),
        memoryLimitMB: parseFloat(memoryLimitMB.toFixed(2)),
        diskUsedGB: parseFloat(diskUsedGB.toFixed(2)),
        diskLimitGB
      };
    } catch (err) {
      logger.error('Failed to get container stats', err);
      return { cpuPercent: 0, memoryMB: 0, memoryLimitMB: 1024, diskUsedGB: 0, diskLimitGB: 10 };
    }
  }

  async getContainerStatus(userId: string): Promise<'running' | 'stopped' | 'error' | 'not_found'> {
    const containerName = this.getContainerName(userId);
    const container = docker.getContainer(containerName);
    try {
      const info = await container.inspect();
      if (info.State.Running) return 'running';
      if (info.State.Status === 'exited') return 'stopped';
      return 'error';
    } catch (err: any) {
      if (err.statusCode === 404) return 'not_found';
      return 'error';
    }
  }

  async startContainer(userId: string) {
    const containerName = this.getContainerName(userId);
    const container = docker.getContainer(containerName);
    await container.start();
    
    const db = getDb();
    db.prepare('UPDATE users SET container_status = ? WHERE id = ?').run('running', userId);
  }

  async stopContainer(userId: string) {
    const containerName = this.getContainerName(userId);
    const container = docker.getContainer(containerName);
    await container.stop();
    
    const db = getDb();
    db.prepare('UPDATE users SET container_status = ? WHERE id = ?').run('stopped', userId);

    await notificationService.emit(userId, {
      type: 'container:stopped',
      title: 'Stone computer stopped',
      body: 'Your personal AI cloud computer has been stopped.',
      severity: 'warn'
    });
  }

  async restartContainer(userId: string) {
    const containerName = this.getContainerName(userId);
    const container = docker.getContainer(containerName);
    await container.restart();
    
    const db = getDb();
    db.prepare('UPDATE users SET container_status = ? WHERE id = ?').run('running', userId);

    await notificationService.emit(userId, {
      type: 'container:restarted',
      title: 'Stone computer restarted',
      body: 'Your personal AI cloud computer has been restarted.',
      severity: 'warn'
    });
  }

  async destroyContainer(userId: string) {
    const containerName = this.getContainerName(userId);
    const volumeName = this.getVolumeName(userId);
    const container = docker.getContainer(containerName);
    
    try {
      await container.stop();
    } catch (e) {}
    
    try {
      await container.remove({ force: true });
    } catch (e) {}

    try {
      const volume = docker.getVolume(volumeName);
      await volume.remove();
    } catch (e) {}

    const db = getDb();
    db.prepare('UPDATE users SET container_status = ?, container_id = NULL, container_port = NULL WHERE id = ?')
      .run('destroyed', userId);
  }

  async getLogs(userId: string, tail: number = 100) {
    const containerName = this.getContainerName(userId);
    const container = docker.getContainer(containerName);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true
    });
    // Logs from dockerode are multiplexed, need to clean them up if not using demux
    // For simple text return, we can just strip the 8-byte header from each line
    const buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(logs as any);
    let output = '';
    let offset = 0;
    while (offset < buffer.length) {
      // header is 8 bytes: [type, 0, 0, 0, size, size, size, size]
      if (offset + 8 > buffer.length) break;
      const type = buffer.readUInt8(offset);
      const size = buffer.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size > buffer.length) break;
      output += buffer.toString('utf8', offset, offset + size);
      offset += size;
    }
    return output;
  }
}

export const containerService = new ContainerService();
