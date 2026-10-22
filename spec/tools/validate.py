#!/usr/bin/env python3
"""Validate an Open Tabletop RPG game pack.

Usage: python3 validate.py path/to/pack.json

1. Merges the pack's `include` fragments (arrays concatenate, objects merge,
   later entries replace earlier ones with the same id).
2. Validates the merged pack against schema/pack.schema.json.
3. Checks cross-references: every class, skill, branch, item, enemy, map,
   card, pool, loot table, condition and asset that is named exists.
"""
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA = Path(__file__).resolve().parent.parent / "schema" / "pack.schema.json"
BASE_ACTIONS = {"approach", "flee", "hold"}
LOOT_SPECIAL = {"gold", "xp"}
ASSET_FIELDS = {"image", "portrait", "token", "icon", "music", "background", "vfx", "sfx"}


def merge(into, frag):
    for key, value in frag.items():
        if key in ("$schema", "include"):
            continue
        if isinstance(value, list) and isinstance(into.get(key), list):
            by_id = {e.get("id"): i for i, e in enumerate(into[key]) if isinstance(e, dict) and "id" in e}
            for entry in value:
                if isinstance(entry, dict) and entry.get("id") in by_id:
                    into[key][by_id[entry["id"]]] = entry
                else:
                    into[key].append(entry)
        elif isinstance(value, dict) and isinstance(into.get(key), dict):
            into[key].update(value)
        else:
            into[key] = value


def load_pack(path):
    root = json.loads(path.read_text())
    pack = {k: v for k, v in root.items() if k != "include"}
    for rel in root.get("include", []):
        merge(pack, json.loads((path.parent / rel).read_text()))
    return pack


def walk(node, path=""):
    """Yield (path, dict) for every object in the pack."""
    if isinstance(node, dict):
        yield path, node
        for k, v in node.items():
            yield from walk(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}[{i}]")


def check_refs(pack):
    errors = []
    ids = lambda key: {e["id"] for e in pack.get(key, [])}
    classes = {c["id"]: c for c in pack.get("classes", [])}
    skills, items, enemies = ids("skills"), ids("items"), ids("enemies")
    maps = {m["id"]: m for m in pack.get("maps", [])}
    cards, pools, loot = ids("cards"), ids("cardPools"), ids("lootTables")
    conditions, assets = ids("conditions"), set(pack.get("assets", {}))
    stats = {s["key"] for s in pack.get("stats", [])}

    def need(ok, where, msg):
        if not ok:
            errors.append(f"{where}: {msg}")

    for kind in ("skills", "items", "enemies", "cards", "classes", "maps", "scenarios"):
        seen = set()
        for e in pack.get(kind, []):
            need(e["id"] not in seen, kind, f"duplicate id '{e['id']}'")
            seen.add(e["id"])

    for c in classes.values():
        for s in c.get("startingSkills", []) + [c.get("basicAttack")] * bool(c.get("basicAttack")):
            need(s in skills, f"class {c['id']}", f"unknown skill '{s}'")
        for i in c.get("startingItems", []):
            need(i in items, f"class {c['id']}", f"unknown item '{i}'")
        for k in list(c["baseStats"]) + c.get("keyStats", []):
            need(k in stats, f"class {c['id']}", f"unknown stat '{k}'")

    for s in pack.get("skills", []):
        for entry in s["classes"]:
            cls = classes.get(entry["class"])
            need(cls is not None, f"skill {s['id']}", f"unknown class '{entry['class']}'")
            if cls and "branch" in entry:
                need(entry["branch"] in {b["id"] for b in cls.get("branches", [])},
                     f"skill {s['id']}", f"class '{cls['id']}' has no branch '{entry['branch']}'")

    for e in pack.get("enemies", []):
        for s in e.get("skills", []):
            need(s in skills, f"enemy {e['id']}", f"unknown skill '{s}'")
        for b in e.get("behavior", []):
            need(b["do"] in skills or b["do"] in BASE_ACTIONS, f"enemy {e['id']}", f"behavior uses unknown action '{b['do']}'")
        if "loot" in e:
            need(e["loot"] in loot, f"enemy {e['id']}", f"unknown loot table '{e['loot']}'")

    for t in pack.get("lootTables", []):
        for entry in t["entries"]:
            need(entry["id"] in items or entry["id"] in LOOT_SPECIAL, f"lootTable {t['id']}", f"unknown item '{entry['id']}'")

    for p in pack.get("cardPools", []):
        for entry in p["cards"]:
            need(entry["id"] in cards, f"cardPool {p['id']}", f"unknown card '{entry['id']}'")

    for sc in pack.get("scenarios", []):
        for d in sc["deck"]:
            if "card" in d:
                need(d["card"] in cards, f"scenario {sc['id']}", f"unknown card '{d['card']}'")
            else:
                need(d["pool"] in pools, f"scenario {sc['id']}", f"unknown pool '{d['pool']}'")

    for sid in pack.get("campaign", {}).get("startScenarios", []):
        need(sid in ids("scenarios"), "campaign", f"unknown scenario '{sid}'")

    tiles = pack.get("rules", {}).get("leveling", {}).get("statBoostTiles", [])
    for t in tiles:
        need(t["stat"] in stats or t["stat"] == "primary", "rules.leveling", f"unknown stat '{t['stat']}'")

    symbols = {t.get("symbol") for t in pack.get("terrain", [])} | {"."}
    for m in maps.values():
        rows = m.get("tiles", [])
        if rows:
            need(len(rows) == m["height"], f"map {m['id']}", f"{len(rows)} rows but height {m['height']}")
            for y, row in enumerate(rows):
                need(len(row) == m["width"], f"map {m['id']}", f"row {y} has {len(row)} cols, width {m['width']}")
                for ch in set(row) - symbols:
                    need(False, f"map {m['id']}", f"row {y} uses unknown terrain symbol '{ch}'")

    for path, obj in walk(pack):
        for f in ASSET_FIELDS & obj.keys():
            if isinstance(obj[f], str) and not path.startswith("assets"):
                need(obj[f] in assets, path, f"{f} '{obj[f]}' is not in assets")
        t = obj.get("type")
        if t in ("condition", "removeCondition"):
            need(obj.get("condition") in conditions, path, f"unknown condition '{obj.get('condition')}'")
        if t in ("insertCard", "removeCard", "shuffleIn", "goto"):
            need(obj.get("card") in cards, path, f"unknown card '{obj.get('card')}'")
        if t in ("grant", "take"):
            if "item" in obj:
                need(obj["item"] in items, path, f"unknown item '{obj['item']}'")
            if "loot" in obj:
                need(obj["loot"] in loot, path, f"unknown loot table '{obj['loot']}'")
            if "skill" in obj:
                need(obj["skill"] in skills, path, f"unknown skill '{obj['skill']}'")
        if "hasSkill" in obj:
            need(obj["hasSkill"] in skills, path, f"hasSkill '{obj['hasSkill']}' is not a skill")
        if "spawns" in obj and "map" in obj:
            m = maps.get(obj["map"])
            need(m is not None, path, f"unknown map '{obj['map']}'")
            for sp in obj["spawns"]:
                need(sp["enemy"] in enemies, path, f"unknown enemy '{sp['enemy']}'")
                if m and "at" in sp:
                    need(sp["at"] in m.get("spawnPoints", {}), path, f"map '{m['id']}' has no spawn point '{sp['at']}'")
    return errors


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pack = load_pack(Path(sys.argv[1]))
    validator = Draft202012Validator(json.loads(SCHEMA.read_text()))
    schema_errors = sorted(validator.iter_errors(pack), key=lambda e: list(e.absolute_path))
    for e in schema_errors:
        print(f"schema  {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}")
    ref_errors = check_refs(pack)
    for e in ref_errors:
        print(f"ref     {e}")
    total = len(schema_errors) + len(ref_errors)
    counts = {k: len(pack.get(k, [])) for k in ("classes", "skills", "enemies", "items", "cards", "scenarios")}
    print(f"{pack.get('name')}: {counts} -> {'OK' if not total else f'{total} problem(s)'}")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
