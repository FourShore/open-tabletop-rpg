# Open Tabletop RPG pack spec (draft v0.1)

A game pack is a folder with a `pack.json` manifest. Everything the engine runs
(rules, stats, classes, skills, enemies, maps, event cards, scenarios, art) is
defined here, so a new story never needs a code change.

```
game-spec/
  schema/pack.schema.json   JSON Schema (2020-12) for a merged pack
  tools/validate.py         schema + cross-reference checker
  example-pack/             "The Hollow Road" reference pack
    pack.json               manifest: id, version, assets, include list
    rules.json              stats, dice, derived formulas, leveling, conditions, terrain
    classes.json            6 classes with branches and starting kit
    skills.json             shared skill library (one skill can list several classes)
    bestiary.json           items, loot tables, enemies (with AI rules), maps
    story.json              cards, card pools, scenarios, campaign
```

Validate a pack:

```
pip install jsonschema
python3 tools/validate.py example-pack/pack.json
```

Key conventions

- **Ids** are lowercase (`goblin-archer`, `loot.captain`) and unique per collection.
- **Assets** are referenced by key from the `assets` map, never by path.
- **Expressions** are strings: `"1d8+str"`, `"1 + partySize"`, `"maxHp / 2"`.
- **Every random pick** uses one shape: `{ "id", "weight", "count"?, "when"? }`.
- **Conditions** (`when`, `requires`) use `flag`, `level`, `stat`, `hasSkill`,
  `partySize`, `chance`, ... combined with `all` / `any` / `not`.
- **Effects** are one vocabulary shared by skills, items, terrain, conditions
  and card outcomes: `damage`, `heal`, `condition`, `push`, `grant`,
  `setFlag`, `insertCard`, `startCombat`, `endScenario`, `random`, ...
- **Fragments** listed in `include` are merged: arrays concatenate, objects
  merge, an entry with an existing id replaces it. `extends` lets a story pack
  build on another pack's classes and rules.
- **Turns** default to a heroes phase then an enemy phase, with 2 actions per
  hero (`rules.turn`). Moving costs an action, as does a typical ability
  (`cost`). The `actions` modifier grants extra actions.
- **Combat** happens on the card's `map`. Heroes start on `heroStart`, enemies
  on their `spawnPoints` (spawns with a `round` arrive later). Movement is in 8
  directions; terrain `moveCost` slows or blocks it, `blocksSight` stops line
  of sight, and `defenseBonus` is cover. Each round every enemy picks its
  intent from its `behavior` (the first rule whose `when` holds) and shows it
  before the heroes act. Attacks roll `d20 + stat + attack` against defense;
  saves roll `d20 + saveStat` against the caster's `spellDc`. A hero at 0 HP is
  down: an adjacent ally can spend an action to revive them (`rules.downed`),
  and any heal brings them back. Killing an enemy gives the killer its `xp`
  and rolls its `loot`; the card's `onVictory` rewards come on top.
- **Durations** count cards outside combat and rounds inside it; a condition
  gained in a fight ends with the fight.
- **Between cards** (no prompt open, or in a shop) a hero can equip and
  unequip gear, use an item with a `use` block, and use a skill marked
  `usableOutOfCombat`, once per card. Only `self`, `ally`, `any` and
  `allAllies` targeting works outside a fight; amounts use the user's stats.
- **Campaigns** carry the party from one scenario to the next.
  `campaign.persistBetweenScenarios` lists what heroes keep (`xp` also keeps
  level, stats and skills); anything left out goes back to how a new hero of
  the class starts. Unlisted `hp` means a full heal and unlisted `conditions`
  clears them. Campaign flags and unlocked scenarios always carry over.
- **Stats have no cap** unless `rules.statCap` sets one; scale DCs instead.
- **Level-ups** can be widened with the `levelUpTiles` modifier and rerolled
  for gold with `rules.leveling.reroll`.

## Sharing a pack

Host the pack's files anywhere that serves them with cross-origin requests
allowed (GitHub raw or GitHub Pages work) and share its `pack.json` URL. Any
table can then play it from the home page, and `spec/gallery.json` lists packs
on the home page. Packs from a URL are checked against this schema before a
table opens, and a few limits keep a bad pack from harming the server: maps
are at most 64 squares on a side, a dice roll is at most 100 dice of 1000
sides, one spawn brings at most 40 enemies, and the whole pack is at most 2 MB.

Licensed CC BY 4.0, see [LICENSE.md](LICENSE.md).
