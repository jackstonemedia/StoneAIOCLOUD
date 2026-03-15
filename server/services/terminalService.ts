import { WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import { logger } from '../lib/logger.js';

interface TerminalSession {
  id: string;
  userId: string;
  ws: WebSocket;
  pty: ChildProcess;
}

class TerminalService {
  private sessions: Map<string, TerminalSession> = new Map();

  handleConnection(ws: WebSocket, user: any) {
    const userId = user.id;
    const sessionId = crypto.randomUUID();

    // Check session limit
    const userSessions = Array.from(this.sessions.values()).filter(s => s.userId === userId);
    if (userSessions.length >= 3) {
      ws.send(JSON.stringify({ type: 'error', message: 'Maximum terminal sessions reached (3)' }));
      ws.close();
      return;
    }

    logger.info(`Starting terminal session ${sessionId} for user ${userId}`);

    // Since node-pty failed, we use child_process.spawn
    // Note: This won't be a full TTY, but it's a fallback
    const ptyProcess = spawn('docker', [
      'exec', '-it', '-u', 'stone',
      `stone_${userId}`,
      '/bin/bash', '--login'
    ], {
      env: { ...process.env, TERM: 'xterm-256color', HOME: '/home/stone' }
    });

    const session: TerminalSession = {
      id: sessionId,
      userId,
      ws,
      pty: ptyProcess
    };

    this.sessions.set(sessionId, session);

    ptyProcess.stdout?.on('data', (data) => {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    });

    ptyProcess.stderr?.on('data', (data) => {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    });

    ws.on('message', (message: string) => {
      try {
        const msg = JSON.parse(message);
        switch (msg.type) {
          case 'input':
            ptyProcess.stdin?.write(msg.data);
            break;
          case 'resize':
            // child_process doesn't support resize like node-pty
            logger.warn('Terminal resize not supported with child_process fallback');
            break;
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (err) {
        logger.error('Failed to parse terminal message', err);
      }
    });

    ws.on('close', () => {
      this.cleanupSession(sessionId);
    });

    ptyProcess.on('exit', () => {
      ws.close();
      this.cleanupSession(sessionId);
    });
  }

  private cleanupSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      logger.info(`Cleaning up terminal session ${sessionId}`);
      session.pty.kill('SIGHUP');
      this.sessions.delete(sessionId);
    }
  }

  killAllUserSessions(userId: string) {
    this.sessions.forEach((session, sessionId) => {
      if (session.userId === userId) {
        this.cleanupSession(sessionId);
        session.ws.close();
      }
    });
  }

  getActiveSessions(userId: string): number {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId).length;
  }
}

export const terminalService = new TerminalService();
