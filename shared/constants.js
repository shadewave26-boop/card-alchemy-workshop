// クライアント・サーバー共用の定数定義。
// イベント名や入力上限をここで一元管理し、両者のずれを防ぐ。

export const TOTAL_ROUNDS = 8;

export const CARD_TYPES = ['normal', 'effect', 'fusion', 'spell', 'trap'];

export const CARD_TYPE_LABEL = {
  normal: '通常モンスター',
  effect: '効果モンスター',
  fusion: '融合モンスター',
  spell: '魔法カード',
  trap: '罠カード',
};

// 魔法カードの種類（ラウンド3の担当者が選択する）
export const SPELL_KINDS = ['通常', '装備', '永続', '速攻', 'フィールド'];

// 罠カードの種類（ラウンド3の担当者が選択する）
export const TRAP_KINDS = ['通常', '永続', 'カウンター'];

export const ATTRIBUTES = ['闇', '光', '地', '水', '炎', '風'];

// 種族候補（サーバー側でランダムに1つ決定する）
export const SPECIES = [
  'ドラゴン族', '魔法使い族', '戦士族', '獣族', '獣戦士族', '鳥獣族',
  '悪魔族', '天使族', 'アンデット族', '機械族', '昆虫族', '恐竜族',
  '魚族', '海竜族', '水族', '炎族', '雷族', '岩石族', '植物族',
  'サイキック族', '幻想魔族',
];

// 続き／新効果モード
export const MODES = { CONTINUE: 'continue', NEW: 'new' };

export const CIRCLED = ['①', '②', '③', '④', '⑤'];

// 入力制限（クライアントのmaxLengthとサーバー検証の両方で使用）
export const LIMITS = {
  playerNameMin: 1,
  playerNameMax: 12,
  nameHalfMax: 16,
  materialMax: 24,
  textMax: 120,
  atkMin: 0,
  atkMax: 9999,
  levelMin: 1,
  levelMax: 12,
};

// クライアント → サーバー
export const C2S = {
  CREATE: 'room:create',
  JOIN: 'room:join',
  RECONNECT: 'room:reconnect',
  LEAVE: 'room:leave',
  START: 'game:start',
  DRAFT: 'round:draft',
  SUBMIT: 'round:submit',
  SYNC: 'state:sync',
  REVEAL: 'results:reveal',
  NEXT: 'results:next',
  RESTART: 'results:restart',
  ADD_BOT: 'dev:addBot',
};

// サーバー → クライアント
export const S2C = {
  CREATED: 'room:created',
  JOINED: 'room:joined',
  ROOM_STATE: 'room:state',
  ROOM_ERROR: 'room:error',
  GAME_STARTED: 'game:started',
  ROUND_STATE: 'round:state',
  PROGRESS: 'round:progress',
  SUBMITTED: 'round:submitted',
  AUTO_SUBMITTED: 'round:autoSubmitted',
  ADVANCED: 'round:advanced',
  RESULTS: 'game:results',
  RESULTS_STATE: 'results:state',
  SESSION_INVALID: 'session:invalid',
};
