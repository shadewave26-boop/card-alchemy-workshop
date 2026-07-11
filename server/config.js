import dotenv from 'dotenv';

dotenv.config();

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: num(process.env.PORT, 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  redisUrl: process.env.REDIS_URL || '',

  // ルームは最終アクセスから ROOM_TTL_SECONDS 経過で自動破棄
  roomTtlSeconds: num(process.env.ROOM_TTL_SECONDS, 7200),

  minPlayers: 2,
  maxPlayers: Math.min(4, Math.max(2, num(process.env.MAX_PLAYERS, 4))),

  textRoundSeconds: num(process.env.TEXT_ROUND_SECONDS, 90),
  drawingRoundSeconds: num(process.env.DRAWING_ROUND_SECONDS, 150),

  maxImageBytes: num(process.env.MAX_IMAGE_BYTES, 1_500_000),

  // カード名 前半+後半 の間に空白を入れるか（仕様§9 設定可能項目）
  nameJoinSpace: process.env.NAME_JOIN_SPACE === '1',

  // カード種別の選出確率（通常 > 効果 > 融合。合計1になるように）
  cardTypeWeights: { normal: 0.5, effect: 0.35, fusion: 0.15 },

  // 種族の抽選重み。未記載の種族は1.0。
  // 魚族・海竜族は出にくくし、その分ほかの種族（ドラゴン族・魔法使い族・戦士族など）が
  // 相対的に少し出やすくなる。
  speciesWeights: {
    魚族: 0.4,
    海竜族: 0.4,
  },

  // サーバー側タイマーの猶予: 時間切れ直前の下書きを取りこぼさないための遅延
  graceMs: 400,

  // 開発専用: カード種別の固定（productionでは無効）
  forceCardType: !isProd ? (process.env.FORCE_CARD_TYPE || '') : '',
};
