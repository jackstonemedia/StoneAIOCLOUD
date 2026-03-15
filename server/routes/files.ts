import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { fileService } from '../services/fileService.js';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { logger } from '../lib/logger.js';

const router = Router();

// Rate limit: 100 requests/min per user
const fileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many file operations, please try again later.', code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 }
});

router.use(requireAuth);
router.use(fileLimiter);

// Multer setup for memory storage, max 100MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const path = (req.query.path as string) || '/home/stone/';
    const result = await fileService.listFiles(req.user.id, path);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/read', async (req: AuthRequest, res, next) => {
  try {
    const path = req.query.path as string;
    if (!path) return res.status(400).json({ error: 'Path is required', code: 'MISSING_PATH', statusCode: 400 });
    
    const result = await fileService.readFile(req.user.id, path);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/write', async (req: AuthRequest, res, next) => {
  try {
    const { path, content, encoding = 'utf8', createDirs = false } = req.body;
    if (!path || content === undefined) {
      return res.status(400).json({ error: 'Path and content are required', code: 'MISSING_PARAMS', statusCode: 400 });
    }
    
    const result = await fileService.writeFile(req.user.id, path, content, encoding, createDirs);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/mkdir', async (req: AuthRequest, res, next) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'Path is required', code: 'MISSING_PATH', statusCode: 400 });
    
    const result = await fileService.mkdir(req.user.id, path);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req: AuthRequest, res, next) => {
  try {
    const path = req.query.path as string;
    const recursive = req.query.recursive === 'true';
    if (!path) return res.status(400).json({ error: 'Path is required', code: 'MISSING_PATH', statusCode: 400 });
    
    const result = await fileService.deleteFile(req.user.id, path, recursive);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/move', async (req: AuthRequest, res, next) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'From and to paths are required', code: 'MISSING_PARAMS', statusCode: 400 });
    
    const result = await fileService.moveFile(req.user.id, from, to);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/copy', async (req: AuthRequest, res, next) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'From and to paths are required', code: 'MISSING_PARAMS', statusCode: 400 });
    
    const result = await fileService.copyFile(req.user.id, from, to);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/upload', upload.single('file'), async (req: AuthRequest, res, next) => {
  try {
    const file = req.file;
    const destPath = req.body.path || '/home/stone/';
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded', code: 'MISSING_FILE', statusCode: 400 });
    }

    const fullPath = `${destPath.replace(/\/$/, '')}/${file.originalname}`;
    
    // Write the file content as base64
    const base64Content = file.buffer.toString('base64');
    const result = await fileService.writeFile(req.user.id, fullPath, base64Content, 'base64', true);
    
    res.json({ success: true, path: result.path, name: file.originalname, size: result.size });
  } catch (err) {
    next(err);
  }
});

router.get('/download', async (req: AuthRequest, res, next) => {
  try {
    const targetPath = req.query.path as string;
    if (!targetPath) return res.status(400).json({ error: 'Path is required', code: 'MISSING_PATH', statusCode: 400 });
    
    const result = await fileService.readFile(req.user.id, targetPath);
    
    const filename = targetPath.split('/').pop() || 'download';
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
    
    if (result.isBinary) {
      res.send(Buffer.from(result.content, 'base64'));
    } else {
      res.send(result.content);
    }
  } catch (err) {
    next(err);
  }
});

router.post('/search', async (req: AuthRequest, res, next) => {
  try {
    const { query, path = '/home/stone/', type = 'name' } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required', code: 'MISSING_QUERY', statusCode: 400 });
    
    const result = await fileService.search(req.user.id, query, path, type);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/info', async (req: AuthRequest, res, next) => {
  try {
    const path = req.query.path as string;
    if (!path) return res.status(400).json({ error: 'Path is required', code: 'MISSING_PATH', statusCode: 400 });
    
    const result = await fileService.getInfo(req.user.id, path);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/zip', async (req: AuthRequest, res, next) => {
  try {
    const { paths, outputPath } = req.body;
    if (!paths || !Array.isArray(paths) || !outputPath) {
      return res.status(400).json({ error: 'Paths array and outputPath are required', code: 'MISSING_PARAMS', statusCode: 400 });
    }
    
    const result = await fileService.zip(req.user.id, paths, outputPath);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/unzip', async (req: AuthRequest, res, next) => {
  try {
    const { path, outputDir } = req.body;
    if (!path || !outputDir) {
      return res.status(400).json({ error: 'Path and outputDir are required', code: 'MISSING_PARAMS', statusCode: 400 });
    }
    
    const result = await fileService.unzip(req.user.id, path, outputDir);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
