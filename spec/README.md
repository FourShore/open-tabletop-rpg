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
