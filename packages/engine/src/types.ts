// TypeScript view of a merged game pack. Mirrors spec/schema/pack.schema.json;
// the schema is the source of truth and validation runs against it.

export type Text = string | Record<string, string>;
export type Expr = number | string;

export interface Range {
  min?: number;
  max?: number;
}

export interface When {
  all?: When[];
  any?: When[];
  not?: When;
  flag?: string;
  level?: Range;
  partySize?: Range;
  stat?: { key: string; min?: number; max?: number };
  hasSkill?: string;
  hasItem?: string;
  class?: string;
  hpBelow?: number;
  adjacentToEnemy?: boolean;
  round?: Range;
  chance?: number;
}

export interface Weighted {
  id: string;
  weight?: number;
  count?: Expr;
  when?: When;
}

export interface Asset {
  path: string;
  type?: 'image' | 'sprite' | 'audio' | 'music' | 'font' | 'video';
  credit?: string;
}

export interface CheckSpec {
  stat: string | string[];
  dc: Expr;
  mode?: 'individual' | 'each' | 'group' | 'best';
  who?: 'volunteer' | 'random' | 'leader' | 'highestStat';
  threshold?: number;
  allowHelp?: boolean;
  secret?: boolean;
  tags?: string[];
}

export type EffectTarget = 'targets' | 'self' | 'party' | 'roller' | 'chosen' | 'random' | 'allEnemies' | 'adjacent';

export interface Effect {
  type:
    | 'damage' | 'heal' | 'condition' | 'removeCondition' | 'push' | 'pull' | 'teleport' | 'move'
    | 'summon' | 'modifyStat' | 'grant' | 'take' | 'setFlag' | 'clearFlag'
    | 'insertCard' | 'removeCard' | 'shuffleIn' | 'goto' | 'startCombat' | 'startCheck'
    | 'endScenario' | 'narrate' | 'resetCooldowns' | 'random';
  target?: EffectTarget;
  when?: When;
  amount?: Expr;
  damageType?: string;
  condition?: string;
  duration?: number;
  distance?: Expr;
  enemy?: string;
  allied?: boolean;
  count?: Expr;
  stat?: string;
  xp?: Expr;
  gold?: Expr;
  item?: string;
  loot?: string;
  skill?: string;
  split?: 'each' | 'shared';
  flag?: string;
  scope?: 'scenario' | 'campaign';
  card?: string;
  position?: 'top' | 'bottom' | 'random';
  combat?: CombatSpec;
  check?: CheckSpec;
  result?: 'victory' | 'defeat';
  unlock?: string[];
  text?: Text;
  image?: string;
  options?: { weight?: number; effects: Effect[] }[];
}

export type Modifiers = Record<string, Expr>;

export interface StatDef {
  key: string;
  name: Text;
  abbr?: string;
  kind?: 'ability' | 'resource';
}

export interface ConditionDef {
  id: string;
  name: Text;
  positive?: boolean;
  modifiers?: Modifiers;
  skipTurn?: boolean;
  preventMove?: boolean;
  untargetable?: boolean;
  onTurnStart?: Effect[];
  onTurnEnd?: Effect[];
  stacking?: 'refresh' | 'stack' | 'ignore';
  endsOn?: ('rest' | 'combatEnd' | 'act' | 'damaged')[];
}

export interface Leveling {
  maxLevel?: number;
  xpThresholds?: number[];
  tileCount?: { level: Range; count: number }[];
  categoryWeights?: Record<string, number>;
  tierWeights?: { level: Range; weights: number[] }[];
  statBoostTiles?: { stat: string; amount: number; weight?: number; when?: When }[];
  fixedTiles?: { kind: 'anyStat' | 'heal' | 'gold'; amount?: number; label?: Text }[];
  guaranteeSkillTile?: boolean;
  rerollsPerLevel?: number;
  reroll?: { cost: Expr; max?: number };
  emptyTierFallback?: 'lower' | 'higher' | 'nearest' | 'skip';
}

export interface Rules {
  dice?: { check?: string; critOn?: number; fumbleOn?: number; critEffect?: string };
  derived?: Record<string, Expr>;
  statCap?: number;
  turn?: { order?: 'sides' | 'initiative'; actionsPerTurn?: number; diagonalCost?: number; showEnemyIntents?: boolean };
  downed?: { enabled?: boolean; reviveCheck?: CheckSpec; reviveHp?: Expr };
  groupCheckThreshold?: number;
  helpBonus?: number;
  leveling?: Leveling;
}

export interface ClassDef {
  id: string;
  name: Text;
  role?: string;
  token?: string;
  keyStats?: string[];
  baseStats: Record<string, number>;
  hp: { base: number; perLevel: Expr };
  move?: number;
  branches?: { id: string; name: Text }[];
  startingSkills?: string[];
  startingItems?: string[];
  basicAttack?: string;
}

export interface SkillDef {
  id: string;
  name: Text;
  description?: Text;
  tier: number;
  classes: { class: string; branch?: string }[];
  requires?: When;
  weight?: number;
  passive?: boolean;
  modifiers?: Modifiers;
  checkBonus?: Record<string, number>;
  usableOutOfCombat?: boolean;
  cost?: number;
  cooldown?: number;
  usesPerScenario?: number;
  usesPerCombat?: number;
  targeting?: Targeting;
  attack?: { roll?: 'attack' | 'save' | 'auto'; stat?: string; saveStat?: string; bonus?: Expr; halfOnSave?: boolean };
  effects?: Effect[];
  onMiss?: Effect[];
  tags?: string[];
}

export interface Targeting {
  target?: 'self' | 'ally' | 'enemy' | 'any' | 'tile' | 'allAllies' | 'allEnemies';
  range?: number;
  area?: { shape?: 'single' | 'burst' | 'line' | 'cone' | 'ring'; size?: number };
  maxTargets?: number;
  lineOfSight?: boolean;
  friendlyFire?: boolean;
}

export type Point = [number, number];

export interface TerrainDef {
  id: string;
  name?: Text;
  symbol?: string;
  image?: string;
  moveCost?: number;
  blocksSight?: boolean;
  defenseBonus?: number;
  onEnter?: Effect[];
}

export interface MapDef {
  id: string;
  name?: Text;
  width: number;
  height: number;
  background?: string;
  tiles?: string[];
  heroStart?: Point[];
  spawnPoints?: Record<string, Point[]>;
  exits?: Point[];
}

export interface ItemDef {
  id: string;
  name: Text;
  kind: 'equipment' | 'consumable' | 'quest';
  slot?: string;
  rarity?: string;
  price?: number;
  classes?: string[];
  modifiers?: Modifiers;
  grantsSkills?: string[];
  use?: { cost?: number; targeting?: Targeting; effects?: Effect[] };
}

export interface LootTable {
  id: string;
  rolls?: Expr;
  unique?: boolean;
  entries: Weighted[];
}

export interface EnemyDef {
  id: string;
  name: Text;
  token?: string;
  size?: number;
  tags?: string[];
  stats: Record<string, number>;
  hp: Expr;
  defense?: Expr;
  move?: number;
  skills?: string[];
  resist?: Record<string, number>;
  behavior?: { when?: When; do: string; target?: EnemyTargetRule }[];
  xp?: number;
  loot?: string;
}

export type EnemyTargetRule = 'nearest' | 'lowestHp' | 'highestHp' | 'highestThreat' | 'random' | 'self' | 'weakestAlly';

export interface CombatSpec {
  map: string;
  spawns: { enemy: string; count?: Expr; at?: string; when?: When; round?: number }[];
  objective?: { kind?: 'defeatAll' | 'defeatTarget' | 'survive' | 'reachExit' | 'protect'; target?: string; rounds?: number };
}

export interface ChoiceOption {
  label: Text;
  requires?: When;
  check?: CheckSpec;
  onSuccess?: Effect[];
  onFailure?: Effect[];
  outcomes?: Effect[];
}

export interface Card {
  id: string;
  type: 'combat' | 'check' | 'choice' | 'story' | 'shop' | 'rest';
  title: Text;
  text?: Text;
  image?: string;
  music?: string;
  requires?: When;
  combat?: CombatSpec;
  onVictory?: Effect[];
  onDefeat?: Effect[];
  check?: CheckSpec;
  onSuccess?: Effect[];
  onFailure?: Effect[];
  onCritical?: Effect[];
  vote?: 'majority' | 'leader' | 'unanimous';
  options?: ChoiceOption[];
  stock?: Weighted[];
  priceModifier?: Expr;
  outcomes?: Effect[];
}

export type DeckEntry = { card: string } | { pool: string; draw?: Expr; shuffle?: boolean };

export interface Scenario {
  id: string;
  name: Text;
  intro?: Text;
  deck: DeckEntry[];
  onDeckEmpty?: Effect[];
}

export interface Campaign {
  name?: Text;
  intro?: Text;
  startingLevel?: number;
  startingGold?: number;
  startScenarios?: string[];
}

export interface Pack {
  spec: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  include?: string[];
  assets?: Record<string, Asset>;
  rules?: Rules;
  stats?: StatDef[];
  conditions?: ConditionDef[];
  terrain?: TerrainDef[];
  classes?: ClassDef[];
  skills?: SkillDef[];
  items?: ItemDef[];
  lootTables?: LootTable[];
  enemies?: EnemyDef[];
  maps?: MapDef[];
  cards?: Card[];
  cardPools?: { id: string; cards: Weighted[] }[];
  scenarios?: Scenario[];
  campaign?: Campaign;
}
