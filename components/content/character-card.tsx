/* eslint-disable @next/next/no-img-element */

import type { CharacterCredit } from "@/lib/content-experience";

export function CharacterCard({ character }: { character: CharacterCredit }) {
  return (
    <article className="character-card">
      <div className="character-portrait">
        {character.imageUrl
          ? <img src={character.imageUrl} alt={`${character.name} character portrait`} />
          : <span>{character.name.slice(0, 2).toUpperCase()}</span>}
      </div>
      <div>
        <span className="character-role">{character.role}</span>
        <h3>{character.name}</h3>
        {character.description && <p>{character.description}</p>}
        {(character.voiceActor || character.actorName) && (
          <small>{character.voiceActor ? `Voice: ${character.voiceActor}` : `Played by ${character.actorName}`}</small>
        )}
      </div>
    </article>
  );
}
