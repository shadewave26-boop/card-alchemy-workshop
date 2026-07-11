// 種別×ラウンドから「工程仕様」「閲覧可能情報」「最終カードの組み立て」を
// 一元的に決めるモジュール。サーバー検証・クライアントUI・クレジットの
// すべてがここを参照する。

import { CARD_TYPES, SPECIES, MODES, CIRCLED, LIMITS } from '../shared/constants.js';
import { config } from './config.js';
import { weightedPick } from './util.js';

// 種族の抽選テーブル（configの重み指定を反映。未指定は1.0）
const SPECIES_WEIGHTS = Object.fromEntries(
  SPECIES.map((s) => [s, config.speciesWeights[s] ?? 1])
);

/** ゲーム開始時にカード1枚分のテーマ（種別・種族・続き/新効果モード）を確定する */
export function buildCard(index) {
  const forced = CARD_TYPES.includes(config.forceCardType) ? config.forceCardType : null;
  const cardType = forced || weightedPick(config.cardTypeWeights);
  const species = weightedPick(SPECIES_WEIGHTS);

  // 続き／新効果モード（ゲーム中は不変）
  const modes = {};
  if (cardType === 'effect') {
    for (const r of [5, 6, 7]) {
      modes[r] = Math.random() < 0.5 ? MODES.NEW : MODES.CONTINUE;
    }
  } else if (cardType === 'fusion') {
    modes[7] = Math.random() < 0.5 ? MODES.NEW : MODES.CONTINUE;
  }

  return {
    index,
    cardType,
    species,
    modes,
    nameFirst: '',
    nameSecond: '',
    attribute: null,
    level: null,
    atk: null,
    def: null,
    texts: {},
    image: null,
  };
}

export function roundDurationSeconds(round) {
  return round === 8 ? config.drawingRoundSeconds : config.textRoundSeconds;
}

/** カード名: 前半+後半（空白挿入は設定で切替） */
export function fullName(card) {
  const a = card.nameFirst || '';
  const b = card.nameSecond || '';
  const sep = a && b && config.nameJoinSpace ? ' ' : '';
  return a + sep + b;
}

/**
 * ラウンドrの工程仕様。担当者のUI表示・入力種別・検証条件を決める。
 * kind: nameFirst | nameSecond | stats | flavor | effect | material | fusionEffect | drawing
 */
export function roundSpecFor(card, round) {
  const t = card.cardType;

  if (round === 1) {
    return {
      kind: 'nameFirst', input: 'line', maxLength: LIMITS.nameHalfMax,
      title: 'カード名・前半',
      description: 'カード名の前半を自由に考えましょう。後半は次のプレイヤーが担当します。',
      placeholder: '例：暗黒の',
    };
  }
  if (round === 2) {
    return {
      kind: 'nameSecond', input: 'line', maxLength: LIMITS.nameHalfMax,
      title: 'カード名・後半',
      description: '前半に続けて、カード名の後半を考えましょう。',
      placeholder: '例：竜騎士', prevLabel: 'カード名・前半',
    };
  }
  if (round === 3) {
    return {
      kind: 'stats', input: 'stats',
      title: 'ステータス',
      description: 'このモンスターの属性・レベル・ATK・DEFを決めましょう。',
      prevLabel: '完成したカード名',
    };
  }
  if (round === 8) {
    return {
      kind: 'drawing', input: 'drawing',
      title: 'イラスト',
      description: '完成したカード情報を参考に、カード中央に入るモンスターのイラストを描きましょう。',
    };
  }

  // ---- ラウンド4〜7: カード種別で分岐 ----
  if (t === 'normal') {
    const i = round - 3; // 1..4
    return {
      kind: 'flavor', input: 'multiline', maxLength: LIMITS.textMax,
      title: `フレーバーテキスト${CIRCLED[i - 1]}`,
      description: round === 4
        ? 'このモンスターの設定や特徴を表す説明文を書きましょう。'
        : '直前の文章だけを手がかりに、続きの文章を自由に書きましょう。',
      prevLabel: round === 4 ? 'ステータス' : `フレーバーテキスト${CIRCLED[round - 5]}`,
    };
  }

  if (t === 'effect') {
    const i = round - 3; // 1..4
    const base = {
      kind: 'effect', input: 'multiline', maxLength: LIMITS.textMax,
      title: `効果テキスト${CIRCLED[i - 1]}`,
    };
    if (round === 4) {
      return { ...base, description: 'このモンスターの最初の効果テキストを書きましょう。', prevLabel: 'ステータス' };
    }
    const mode = card.modes[round];
    if (mode === MODES.CONTINUE) {
      return {
        ...base, mode,
        description: '直前の効果文の続きを書いてください。（改行せずにつながります）',
        prevLabel: `効果テキスト${CIRCLED[round - 5]}`,
      };
    }
    return {
      ...base, mode,
      description: '新しい効果を書き始めてください。',
      placeholder: '新しい効果の内容',
      prevLabel: `効果テキスト${CIRCLED[round - 5]}`,
    };
  }

  // fusion
  if (round === 4) {
    return {
      kind: 'material', input: 'line', maxLength: LIMITS.materialMax,
      title: '融合素材①',
      description: 'このモンスターの1体目の融合素材の名前を考えましょう。',
      placeholder: '例：スモールドラゴン', prevLabel: 'ステータス',
    };
  }
  if (round === 5) {
    return {
      kind: 'material', input: 'line', maxLength: LIMITS.materialMax,
      title: '融合素材②',
      description: '2体目の融合素材の名前を考えましょう。',
      placeholder: '例：堕天使マリー', prevLabel: '融合素材①',
    };
  }
  if (round === 6) {
    return {
      kind: 'fusionEffect', input: 'multiline', maxLength: LIMITS.textMax,
      title: '効果テキスト①',
      description: '融合素材の入力工程は終了しました。ここからは融合モンスターの効果テキストを書きましょう。',
      prevLabel: '融合素材②',
    };
  }
  // round 7
  const mode = card.modes[7];
  const base7 = {
    kind: 'fusionEffect', input: 'multiline', maxLength: LIMITS.textMax,
    title: '効果テキスト②', mode, prevLabel: '効果テキスト①',
  };
  if (mode === MODES.CONTINUE) {
    return { ...base7, description: '直前の効果文の続きを書いてください。（改行せずにつながります）' };
  }
  return {
    ...base7,
    description: '新しい効果を書き始めてください。（直前の効果とは改行で区切られます）',
    placeholder: '新しい効果の内容',
  };
}

/**
 * 情報公開の原則（仕様§8）: 担当者に見せてよい「直前の工程の成果物」だけを返す。
 * カード種別・種族は round:state 側で常に送る。
 */
export function visibleFor(card, round) {
  switch (round) {
    case 1: return {};
    case 2: return { nameFirst: card.nameFirst || '' };
    case 3: return { name: fullName(card) };
    case 4: return { stats: { attribute: card.attribute, level: card.level, atk: card.atk, def: card.def } };
    case 5: case 6: case 7:
      return { prevText: card.texts[round - 1] || '' };
    case 8: return { card: assembleCard(card) }; // 最終ラウンドは全情報
    default: return {};
  }
}

/** 効果モンスター: 全断片を改行せずそのまま連結（番号も改行も入れない） */
function joinEffectTexts(card) {
  return [4, 5, 6, 7].map((r) => card.texts[r] || '').join('');
}

/** 融合モンスター: R6+R7の効果を改行せず連結 */
function joinFusionTexts(card) {
  return (card.texts[6] || '') + (card.texts[7] || '');
}

/** 全8ラウンドの成果を1枚のカードデータへ組み立てる */
export function assembleCard(card) {
  const base = {
    index: card.index,
    no: card.index + 1,
    cardType: card.cardType,
    species: card.species,
    name: fullName(card) || '名もなきモンスター',
    attribute: card.attribute || '闇',
    level: card.level ?? 4,
    atk: card.atk ?? 0,
    def: card.def ?? 0,
    image: card.image || null,
    materialsText: null,
    bodyText: '',
  };

  if (card.cardType === 'normal') {
    // フレーバーも全断片を改行なしで連結
    base.bodyText = [4, 5, 6, 7].map((r) => card.texts[r] || '').join('')
      || '……その姿を見た者は少なく、多くは語られていない。';
  } else if (card.cardType === 'effect') {
    base.bodyText = joinEffectTexts(card) || '（この効果は謎に包まれている）';
  } else {
    const m1 = card.texts[4] || '？？？';
    const m2 = card.texts[5] || '？？？';
    base.materialsText = `「${m1}」＋「${m2}」`;
    base.bodyText = joinFusionTexts(card) || '（この効果は謎に包まれている）';
  }
  return base;
}

/** 結果発表のクレジット役割名（カード種別でラウンド4〜7の名称が変わる） */
export function roleName(cardType, round) {
  if (round === 1) return 'カード名・前半';
  if (round === 2) return 'カード名・後半';
  if (round === 3) return 'ステータス';
  if (round === 8) return 'イラスト';
  const i = round - 4; // 0..3
  if (cardType === 'normal') return `フレーバーテキスト${CIRCLED[i]}`;
  if (cardType === 'effect') return `効果テキスト${CIRCLED[i]}`;
  // fusion
  if (round === 4) return '融合素材①';
  if (round === 5) return '融合素材②';
  if (round === 6) return '効果テキスト①';
  return '効果テキスト②';
}
