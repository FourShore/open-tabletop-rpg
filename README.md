# Open Tabletop RPG

A browser-based co-op fantasy RPG. One shared screen shows the world, event
cards and a tactical combat grid; each player controls their hero from their
phone. Every rule, class, skill, enemy, event card and scenario comes from an
open JSON **game pack**, so anyone can write their own story.

- **Spec:** [`spec/`](spec/README.md) holds the JSON Schema, a reference pack
  ("The Hollow Road"), and a validator.
- **Design doc:** [Design & JSON Spec](https://claude.ai/artifact/JtztkqPLxJzu96KktcQQuw)

## Engine

`packages/engine` is the rules engine: a pure TypeScript state machine that
loads and validates a pack and runs its event deck (cards, checks, votes,
shops, rewards, level-up tile draws). Grid combat is not built yet; combat
cards pause and ask for the result.

```
npm install
npm test                                   # engine tests
npm run validate -- spec/example-pack      # check a pack
npm run play                               # play The Hollow Road in the terminal
npm run play -- --auto --seed 42           # watch it play itself
npm run play -- --players "Ana:rogue,Ben:bard" --seed 7
```

## Roadmap

1. Engine + spec (in progress)
2. Rooms: main screen and phone controllers over WebSockets
3. Grid combat
4. Progression: inventory, shop UI, campaign saves
5. Open ecosystem: pack loading by URL, a pack gallery, an editor

## License

Code is [MIT](LICENSE). The spec and the example pack's content are
[CC BY 4.0](spec/LICENSE.md).
