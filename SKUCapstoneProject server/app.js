require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Server } = require('socket.io');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');

const { connectDB } = require('./src/db');
const receiver = require('./src/receiver');

const temhuController = require('./src/controllers/TemhuController');
const sleepController = require('./src/controllers/sleepController');

const app = express();
const server = http.createServer(app);

// =========================================================
// WebSocket (IoT device)
// =========================================================
const wss = new WebSocket.Server({ server });
app.set('wss', wss);

// =========================================================
// Socket.IO (Android realtime)
// =========================================================
const io = new Server(server, {
  cors: { origin: '*' }
});
app.set('io', io);

io.on('connection', (socket) => {
  console.log('📱 안드로이드 연결됨:', socket.id);

  socket.on('register', (userId) => {
    socket.join(userId);
    console.log(`✅ [${userId}] 소켓 등록됨`);
  });

  socket.on('disconnect', () => {
    console.log('📱 안드로이드 연결 끊김:', socket.id);
  });
});

// =========================================================
// Middleware
// =========================================================
const PORT = process.env.PORT || 3001;

// 🔥 도커/내부 호출용 URL
const BASE_URL = process.env.INTERNAL_API_URL || `http://127.0.0.1:${PORT}`;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
  console.log("==============================================");
  console.log("📥 요청:", req.method, req.originalUrl);
  next();
});

// =========================================================
// ROUTES
// =========================================================

// HEALTH CHECK
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// AUTH
const authRouter = require('./src/routes/authRoutes');
app.use('/auth', authRouter);

// DATA
const policyRouter = require('./src/routes/policyRoutes');
const vaccineRouter = require('./src/routes/vaccineRoutes');

app.use('/api/policies', policyRouter);
app.use('/api/vaccine', vaccineRouter);

// SENSOR
const temhuRoutes = require('./src/routes/temhuRoutes');
const sleepRoutes = require('./src/routes/sleepRoutes');

app.use('/api/temhu', temhuRoutes);
app.use('/api/sleep', sleepRoutes);

// SMARTTHINGS
const smartThingsRouter = require('./src/routes/smartThingsRoutes');
app.use('/api/smartthings', smartThingsRouter);

// AI
const aiRouter = require('./src/routes/airouter');
app.use('/api/ai', aiRouter);

// OTHER
const videoRoutes = require('./src/routes/videoRoutes');
const soundAnalysisRoutes = require('./src/routes/soundAnalysisRoutes');

app.use('/api/video', videoRoutes);
app.use('/api/sound-analysis', soundAnalysisRoutes);

// =========================================================
// STREAM
// =========================================================
app.use('/stream', (req, res, next) => {
  if (req.path.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
  } else if (req.path.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/mp2t');
  }
  next();
}, express.static(path.join(__dirname, 'public/stream')));

// =========================================================
// CRON JOBS
// =========================================================

//setInterval(() => {
//  temhuController.saveBufferToDB();
//}, 30000);

cron.schedule('*/10 * * * *', () => {
  console.log('⏰ [10분] 수면 점수 계산');
  sleepController.processHourlyBatch();
});

cron.schedule('0 * * * *', () => {
  console.log('⏰ [1시간] 수면 점수 집계');
  sleepController.processHourlyBatch();
});

cron.schedule('0 8 * * *', () => {
  console.log('🌅 [AI] 일일 리포트 생성');
  sleepController.generateDailyComprehensiveReport();
});

// =========================================================
// SERVER START
// =========================================================

server.listen(PORT, '0.0.0.0', async () => {
    console.log('==============================================');

    try {
        await connectDB();
        console.log(`✅ MongoDB 연결 성공`);

        receiver.init(wss);
        console.log(`✅ WebSocket(Receiver) 초기화 성공`);
        axios.post(`${BASE_URL}/api/video/start`).catch(() => {});
        axios.post(`${BASE_URL}/api/sound-analysis/start`).catch(() => {});

        console.log(`🚀 서버 가동 중: http://0.0.0.0:${PORT}`);
        console.log(`🔗 내부 BASE_URL: ${BASE_URL}`);

    } catch (err) {
        console.error("❌ 서버 초기화 중 오류 발생:", err.message);
    }

    console.log('==============================================');
});