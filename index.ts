import Fastify from 'fastify';
import cors from '@fastify/cors'
import fastifyStat from '@fastify/static'
const app = Fastify({ logger: false });

import path, { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { rename, writeFile } from 'fs/promises';
import crypto from 'crypto';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


await app.register(cors)
await app.register(fastifyStat, { root: join(__dirname, 'dist'), });

const secretKey = process.env.SECRET_KEY
const rootPath = process.env.ROOT_PATH
if (!secretKey) {
    throw new Error('SECRET_KEY is not set'); 
}
if (!rootPath) {
    throw new Error('ROOT_PATH is not set'); 
}

// 创建 HMAC 函数
function createHmac(message: string, secretKey: string) {
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(message);
    return hmac.digest('hex');
}

// 验证 HMAC
function verifyHmac(message: string, secretKey: string, hash: string) {
    const calculatedHash = createHmac(message, secretKey);
    console.log(`calculatedHash: ${calculatedHash}, hash: ${hash}`);
    
    return calculatedHash === hash;
}

app.get<{ Params: { pj: string, ['*']: string }, Querystring: { secretKey: string } }>('/file/:pj/*', async (req, res) => {
    const { pj, '*': pth } = req.params;
    const targetFile = path.join(pj, pth);
    
    if (!verifyHmac(targetFile, secretKey, req.query.secretKey)) {
        return res.status(401).send({
            message: 'Invalid secret key'
        });
    }

    return res.sendFile(targetFile, rootPath);
});

app.get<{ Params: { pj: string, ['*']: string }, Querystring: { secretKey: string }, Body: string }>
    ('/compile/:pj/*', async (req, res) => {
        const { pj, '*': pth } = req.params;
        const targetFile = path.join(pj, pth);
        console.log(`targetFile: ${targetFile}`);
        
        console.log(createHmac(targetFile, secretKey));
        if (!verifyHmac(targetFile, secretKey, req.query.secretKey)) {
            return res.status(401).send({
                message: 'Invalid secret key'
            });
        }

        const targetPjPath = path.join(rootPath, pj);
        res.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',

        });
        function formatSSEData(data: any): string {
            const message = typeof data === 'string' ? data : JSON.stringify(data);

            // 处理多行数据：
            // 1. 将整个消息按换行符分割
            // 2. 每行前面加上 "data: "
            // 3. 最后加上额外的换行符
            return message
                .split('\n')
                .map(line => `data: ${line}`)
                .join('\n') + '\n\n';
        }
        const process = spawn('npm', ['run', 'build'], { cwd: targetPjPath });

        process.stdout.on('data', (data) => {
            res.raw.write(`event: stdout\n${formatSSEData(data.toString())}`);
        });
        process.stderr.on('data', (data) => {
            res.raw.write(`event: stderr\n${formatSSEData(data.toString())}`);
        });
        process.on('close', (code) => {
            res.raw.end(`event: close\n${formatSSEData({ code })}`);

        });
    });

app.post<{ Params: { pj: string, ['*']: string }, Querystring: { secretKey: string }, Body: string }>
    ('/file/:pj/*', async (req, res) => {
        const { pj, '*': pth } = req.params;
        const targetFile = path.join(pj, pth);
        console.log(createHmac(targetFile, secretKey));
        if (!verifyHmac(targetFile, secretKey, req.query.secretKey)) {
            return res.status(401).send({
                message: 'Invalid secret key'
            });
        }
        const targetPath = path.join(rootPath, targetFile);
        await rename(targetPath, `${targetPath}.${Date.now()}.bak`)
        await writeFile(targetPath, req.body)
        
        return res.send({
            message: 'File uploaded successfully'
        });
    });


app.listen({ port: 3000, host: '0.0.0.0' })