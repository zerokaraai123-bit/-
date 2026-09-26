require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;
const RATE_LIMIT_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 20);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('対応していない画像形式です (jpg/png/webp のみ)'));
    }
    cb(null, true);
  },
});

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: RATE_LIMIT_PER_HOUR,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '短時間の利用回数上限に達しました。しばらくしてからお試しください。' },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const HAIRSTYLE_PRESETS = {
  short_bob: 'a neat short bob haircut',
  layered_medium: 'layered medium-length hair with soft waves',
  long_straight: 'long straight hair',
  perm_curls: 'loose textured curls (perm style)',
  short_fade: 'a short textured crop with a low fade (men)',
  slick_back: 'a slicked-back short hairstyle (men)',
};

const HAIR_COLOR_PRESETS = {
  black: 'natural black',
  dark_brown: 'dark brown',
  ash_brown: 'ash brown',
  honey_blonde: 'honey blonde',
  ash_gray: 'ash gray',
  burgundy: 'deep burgundy red',
};

const IMPRESSION_PRESETS = {
  softer_brows: 'slightly softer, naturally groomed eyebrows',
  fuller_brows: 'slightly fuller, well-defined eyebrows',
  clear_hairline: 'a slightly cleaner, more defined hairline',
  glasses_round: 'wearing round stylish glasses',
  glasses_square: 'wearing square stylish glasses',
  fresh_skin: 'subtly clearer, well-rested looking skin tone (no makeup added)',
};

function buildPrompt(mode, options) {
  const base =
    'Edit this portrait photo realistically. Keep the exact same person, ' +
    'same facial identity, same facial structure, same expression, same pose, ' +
    'same background and same lighting. Do not change the face shape, eyes, nose, ' +
    'jawline or any bone structure. Make only the following change: ';

  if (mode === 'hairstyle') {
    const style = HAIRSTYLE_PRESETS[options.styleKey] || options.customPrompt;
    if (!style) throw new Error('髪型が指定されていません');
    return `${base}change the hairstyle to ${style}. Blend it naturally with the lighting and skin tone.`;
  }

  if (mode === 'haircolor') {
    const color = HAIR_COLOR_PRESETS[options.colorKey] || options.customPrompt;
    if (!color) throw new Error('髪色が指定されていません');
    return `${base}change the hair color to ${color}, keeping the same hairstyle shape.`;
  }

  if (mode === 'impression') {
    const change = IMPRESSION_PRESETS[options.impressionKey] || options.customPrompt;
    if (!change) throw new Error('変化の項目が指定されていません');
    return `${base}${change}. This must be a subtle, natural, realistic change — not an exaggerated or surgical transformation.`;
  }

  throw new Error('不正なモードです');
}

app.get('/api/presets', (req, res) => {
  res.json({
    hairstyle: HAIRSTYLE_PRESETS,
    haircolor: HAIR_COLOR_PRESETS,
    impression: IMPRESSION_PRESETS,
  });
});

app.post('/api/edit', limiter, upload.single('photo'), async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({
        error: 'サーバーに OPENAI_API_KEY が設定されていません。.env を確認してください。',
      });
    }

    const consent = req.body.consent === 'true' || req.body.consent === true;
    if (!consent) {
      return res.status(400).json({ error: '送信には同意チェックが必要です。' });
    }

    if (!req.file) {
      return res.status(400).json({ error: '写真がアップロードされていません。' });
    }

    const mode = req.body.mode;
    const options = {
      styleKey: req.body.styleKey,
      colorKey: req.body.colorKey,
      impressionKey: req.body.impressionKey,
      customPrompt: req.body.customPrompt,
    };

    const prompt = buildPrompt(mode, options);

    const imageFile = await OpenAI.toFile(req.file.buffer, 'photo.png', {
      type: req.file.mimetype,
    });

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024',
    });

    const b64 = result.data[0].b64_json;

    req.file.buffer = null;

    return res.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    console.error('edit error:', err.message);
    return res.status(500).json({ error: '処理に失敗しました: ' + err.message });
  } finally {
    if (req.file) req.file.buffer = null;
  }
});

app.listen(PORT, () => {
  console.log(`face-sim-app server running: http://localhost:${PORT}`);
  if (!openai) {
    console.warn('警告: OPENAI_API_KEY が未設定です。');
  }
});