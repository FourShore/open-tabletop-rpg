// A hero's pack on the phone, between cards: swap gear, drink a potion, or use
// a skill that works outside a fight (like a heal on a friend).

import type { HeroUse, HeroView } from '@otrpg/server/view';
import { useState } from 'react';

type Act = (a: Record<string, unknown>) => void;

export function Gear({ hero, party, act }: { hero: HeroView; party: HeroView[]; act: Act }) {
  const [aiming, setAiming] = useState<HeroUse>();
  const use = (u: HeroUse, targetId?: string) => {
    setAiming(undefined);
    act(u.kind === 'item' ? { type: 'useItem', playerId: hero.id, itemId: u.id, targetId } : { type: 'useSkill', playerId: hero.id, skillId: u.id, targetId });
  };
  const usable = new Map(hero.uses.filter((u) => u.kind === 'item').map((u) => [u.id, u]));
  const skills = hero.uses.filter((u) => u.kind === 'skill');

  if (aiming) {
    return (
      <div className="gear stack">
        <h3>{aiming.name}: on whom?</h3>
        {party.map((p) => (
          <button key={p.id} onClick={() => use(aiming, p.id)}>
            {p.name} <span className="muted small">{p.hp}/{p.maxHp} HP</span>
          </button>
        ))}
        <button className="ghost" onClick={() => setAiming(undefined)}>
          Back
        </button>
      </div>
    );
  }
  const pick = (u: HeroUse) => (u.aim === 'ally' ? setAiming(u) : use(u));

  return (
    <div className="gear">
      <h3 className="small">Worn</h3>
      {hero.equipment.length === 0 && <p className="muted small">Nothing.</p>}
      <ul className="items">
        {hero.equipment.map((e) => (
          <li key={e.slot}>
            <div>
              <b>{e.name}</b>
              <div className="muted small">{e.details}</div>
            </div>
            <button className="ghost" onClick={() => act({ type: 'unequip', playerId: hero.id, slot: e.slot })}>
              Take off
            </button>
          </li>
        ))}
      </ul>
      <h3 className="small">Pack</h3>
      {hero.inventory.length === 0 && <p className="muted small">Empty.</p>}
      <ul className="items">
        {hero.inventory.map((i) => {
          const u = usable.get(i.itemId);
          return (
            <li key={i.itemId}>
              <div>
                <b>
                  {i.name}
                  {i.count > 1 ? ` ×${i.count}` : ''}
                </b>
                <div className="muted small">{i.details}</div>
              </div>
              {i.equippable && <button onClick={() => act({ type: 'equip', playerId: hero.id, itemId: i.itemId })}>Equip</button>}
              {u && (
                <button disabled={!!u.blocked} title={u.blocked} onClick={() => pick(u)}>
                  Use
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {skills.length > 0 && (
        <>
          <h3 className="small">Skills</h3>
          <ul className="items">
            {skills.map((u) => (
              <li key={u.id}>
                <div>
                  <b>{u.name}</b>
                  <div className="muted small">{u.blocked ?? u.description}</div>
                </div>
                <button disabled={!!u.blocked} onClick={() => pick(u)}>
                  Use
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
